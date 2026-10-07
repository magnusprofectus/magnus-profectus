// Server-mode sync layer (local test phase, user-approved 2026-09-30).
// Dexie stays the runtime store (all liveQuery UI unchanged); the server is the
// source of truth for logged-in users:
//  - login: push local dirty rows (earlier anonymous work) → replace Dexie with server bundle
//  - every repo write: row is already stamped _dirty → pushed here immediately
//  - pull: on login and on window focus (last-writer-wins per row, fine for test phase)
// Logout clears this browser's copy so a shared device doesn't leak the next user in.
import { db } from "./db";
import { reseed } from "./seed";
import { mergeDefaults } from "./defaults";

export const SYNC_TABLES = ["user_settings", "programs", "workouts", "workout_exercises", "exercises", "sessions", "exercise_logs"] as const;
type SyncTable = (typeof SYNC_TABLES)[number];

let currentUser: { id: string; username: string } | null = null;
let serverUp = false;
export const getUser = () => currentUser;
export const isServerUp = () => serverUp;

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, { credentials: "same-origin", ...init });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

export async function checkSession(): Promise<{ user: { id: string; username: string } | null; serverUp: boolean }> {
  try {
    const { ok, body } = await api("/api/me");
    serverUp = ok;
    currentUser = ok ? body.user : null;
  } catch { serverUp = false; currentUser = null; }
  return { user: currentUser, serverUp };
}

export async function register(username: string, password: string) {
  const { ok, body } = await api("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  if (!ok) throw new Error(body.error ?? "Registration failed.");
  await afterAuth();
}

export async function login(username: string, password: string) {
  const { ok, body } = await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  if (!ok) throw new Error(body.error ?? "Login failed.");
  await afterAuth();
}

/** Server wins at login. Anonymous rows are NOT pushed — the logout→reload cycle
 * re-seeds a fresh anonymous program, and pushing it at login duplicated the default
 * program on the server every cycle (user-reported bug). A brand-new account is
 * seeded AFTER pull, then pushed once. */
async function afterAuth() {
  currentUser = (await checkSession()).user;
  const pulled = await pull({ mergeDefaults: false });
  // brand-new account → starter program + settings, pushed to the server.
  // (Emptiness must be checked BEFORE the defaults merge: a new account already
  // receives the curated Starter Program, which would make it look non-empty.)
  const programs = await db.programs.filter(p => !p.deleted_at).toArray();
  if (programs.length === 0) {
    await reseed();
    await pushDirty();
  } else {
    const settings = await db.user_settings.get("local");
    if (!settings) { await reseed(); await pushDirty(); }
  }
  if (pulled.ok && pulled.body) await runDefaultsMerge(pulled.body);
}

export async function logout() {
  await api("/api/logout", { method: "POST" });
  currentUser = null;
  await db.transaction("rw", SYNC_TABLES as unknown as string[], async () => {
    for (const t of SYNC_TABLES) await db.table(t).clear();
  });
}

export async function pushDirty(): Promise<number> {
  if (!currentUser) return 0;
  const rows: Array<{ table_name: SyncTable; id: string; updated_at: string; deleted: boolean; data: Record<string, unknown> }> = [];
  for (const t of SYNC_TABLES) {
    const all = await db.table(t).toArray();
    for (const row of all) {
      if (!(row as { _dirty?: number })._dirty) continue;
      const { _dirty, ...data } = row as Record<string, unknown>;
      rows.push({ table_name: t, id: String(row.id), updated_at: String(data.updated_at ?? new Date().toISOString()), deleted: !!data.deleted_at, data });
    }
  }
  if (!rows.length) return 0;
  const { ok } = await api("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
  if (ok) await db.transaction("rw", SYNC_TABLES as unknown as string[], async () => {
    for (const t of SYNC_TABLES) {
      const table = db.table(t);
      const dirty = await table.filter(x => !!(x as { _dirty?: number })._dirty).toArray();
      for (const row of dirty) await table.put({ ...row, _dirty: 0 });
    }
  });
  return ok ? rows.length : 0;
}

export async function pull(opts?: { mergeDefaults?: boolean }): Promise<{ ok: boolean; body?: { defaults?: unknown; defaults_user_id?: string } }> {
  if (!currentUser) return { ok: false };
  const { ok, body } = await api("/api/bundle");
  if (!ok) return { ok: false };
  await db.transaction("rw", SYNC_TABLES as unknown as string[], async () => {
    for (const t of SYNC_TABLES) {
      await db.table(t).clear();
      for (const row of (body.tables?.[t] ?? []) as Array<Record<string, unknown>>) await db.table(t).put({ ...row, _dirty: 0 } as never);
    }
  });
  if (opts?.mergeDefaults !== false) await runDefaultsMerge(body);
  return { ok: true, body };
}

/** curated default programs ship with every bundle; merge copies the curator's
 * programs in as read-only local rows (new versions added, old ones unmaintained) */
function runDefaultsMerge(body: { defaults?: unknown; defaults_user_id?: string }): Promise<void> {
  return mergeDefaults(body.defaults as never, currentUser?.id, body.defaults_user_id);
}

/** called by repo after every write — fire-and-forget single-row push with retry */
const retryQueue: Array<{ table_name: SyncTable; id: string; updated_at: string; deleted: boolean; data: Record<string, unknown> }> = [];
let retryTimer: number | null = null;
export function pushRow(table_name: SyncTable, id: string, updated_at: string, deleted: boolean, data: Record<string, unknown>) {
  if (!currentUser) return;
  void api("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: [{ table_name, id, updated_at, deleted, data }] }) })
    .then(({ ok }) => { if (ok) void db.table(table_name).update(id, { _dirty: 0 }); else retryQueue.push({ table_name, id, updated_at, deleted, data }); })
    .catch(() => retryQueue.push({ table_name, id, updated_at, deleted, data }));
  if (retryTimer === null) retryTimer = window.setInterval(() => { void pushDirty(); }, 15000);
}