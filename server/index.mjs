// RP Tracker local test-phase server (user-approved 2026-09-30).
// Zero-dependency Node server: static dist + auth + per-user row store.
// Zero deps on purpose: node:http + node:sqlite (Node 24) + node:crypto scrypt.
// Migration path to Supabase: the `rows` table is generic
// (table_name, id, user_id, updated_at, deleted, data JSON) — dump/transform
// into Postgres tables later; auth swaps to Supabase Auth (email verification,
// recovery added THERE, deliberately absent here).
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { scryptSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 5183);
const DB_PATH = process.env.RP_DB || new URL("./rp.sqlite", import.meta.url).pathname;
const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const COOKIE = "rp_session";
const SESSION_MS = 30 * 86400000;
const TABLES = ["user_settings", "programs", "workouts", "workout_exercises", "exercises", "sessions", "exercise_logs"];

const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rows(table_name TEXT NOT NULL, id TEXT NOT NULL, user_id TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, PRIMARY KEY(table_name, id));
CREATE TABLE IF NOT EXISTS article_clicks(slug TEXT PRIMARY KEY, clicks INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS rows_user ON rows(user_id);
`);

const nowIso = () => new Date().toISOString();
function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = "";
    req.on("data", c => { text += c; if (text.length > 8e6) reject(new Error("too large")); });
    req.on("end", () => { try { resolve(text ? JSON.parse(text) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sessionUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = db.prepare("SELECT * FROM auth_sessions WHERE token=?").get(token);
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  const u = db.prepare("SELECT id, username FROM users WHERE id=?").get(s.user_id);
  return u ?? null;
}
function makeSession(res, userId) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)").run(token, userId, nowIso(), new Date(Date.now() + SESSION_MS).toISOString());
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`);
}
const hash = (pw, salt) => scryptSync(pw, salt, 64).toString("hex");

const DEFAULTS_USER = "defaults"; // curator account: programs here ship to every user
const DEFAULTS_PW_FILE = join(fileURLToPath(new URL(".", import.meta.url)), "defaults-password.txt");
// Ensure the curator account exists at startup. The password is generated once and
// written to server/defaults-password.txt (mode 0600) so the team can log in as
// "defaults" to create/modify the default programs shipped to all users.
let defaultsUserId = null;
{
  let u = db.prepare("SELECT id FROM users WHERE username=?").get(DEFAULTS_USER);
  if (!u) {
    const pw = randomBytes(12).toString("base64url");
    const salt = randomBytes(16).toString("hex");
    u = { id: randomUUID() };
    db.prepare("INSERT INTO users(id,username,pw_hash,pw_salt,created_at) VALUES (?,?,?,?,?)").run(u.id, DEFAULTS_USER, hash(pw, salt), salt, nowIso());
    try { writeFileSync(DEFAULTS_PW_FILE, `${DEFAULTS_USER}:${pw}\n`, { mode: 0o600 }); } catch {}
  }
  defaultsUserId = u.id;
}

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".md": "text/markdown", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".ico": "image/x-icon" };
function serveStatic(req, res, pathname) {
  let file = normalize(join(DIST, pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  // stale-SW self-heal: an old service worker's cached index.html requests a hashed
  // asset that no longer exists; serve the current bundle under that URL so a phone
  // with an outdated SW loads working code (and its SW then updates properly).
  if (/^\/assets\//.test(pathname) && !existsSync(file)) {
    const cur = join(DIST, "assets");
    const target = pathname.endsWith(".css") ? readdirSync(cur).find(f => f.endsWith(".css")) : readdirSync(cur).find(f => f.endsWith(".js") && f.startsWith("index-"));
    if (target) file = join(cur, target);
  }
  if (!existsSync(file)) return json(res, 404, { error: "not built — run npm run build" });
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;
  try {
    if (path === "/api/register" && req.method === "POST") {
      const { username, password } = await readBody(req);
      if (!/^[a-z0-9_-]{3,20}$/.test(username ?? "")) return json(res, 400, { error: "Username must be 3–20 lowercase letters, digits, - or _." });
      if (typeof password !== "string" || password.length < 6) return json(res, 400, { error: "Password must be at least 6 characters." });
      if (db.prepare("SELECT id FROM users WHERE username=?").get(username)) return json(res, 409, { error: "That username is taken." });
      const id = randomUUID(), salt = randomBytes(16).toString("hex");
      db.prepare("INSERT INTO users(id,username,pw_hash,pw_salt,created_at) VALUES (?,?,?,?,?)").run(id, username, hash(password, salt), salt, nowIso());
      makeSession(res, id);
      return json(res, 200, { user: { id, username } });
    }
    if (path === "/api/login" && req.method === "POST") {
      const { username, password } = await readBody(req);
      const u = db.prepare("SELECT * FROM users WHERE username=?").get(String(username ?? ""));
      if (!u) return json(res, 401, { error: "Wrong username or password." });
      const good = Buffer.from(u.pw_hash, "hex"), test = Buffer.from(hash(String(password ?? ""), u.pw_salt), "hex");
      if (good.length !== test.length || !timingSafeEqual(good, test)) return json(res, 401, { error: "Wrong username or password." });
      makeSession(res, u.id);
      return json(res, 200, { user: { id: u.id, username: u.username } });
    }
    if (path === "/api/logout" && req.method === "POST") {
      const token = parseCookies(req)[COOKIE];
      if (token) db.prepare("DELETE FROM auth_sessions WHERE token=?").run(token);
      res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      return json(res, 200, {});
    }
    if (path === "/api/me" && req.method === "GET") {
      const u = sessionUser(req);
      return json(res, 200, u ? { user: u } : { user: null });
    }
    if (path === "/api/bundle" && req.method === "GET") {
      const u = sessionUser(req);
      if (!u) return json(res, 401, { error: "not logged in" });
      const tables = {};
      for (const t of TABLES) tables[t] = db.prepare("SELECT data FROM rows WHERE table_name=? AND user_id=?").all(t, u.id).map(r => JSON.parse(r.data));
      // Default (curated) programs: rows owned by the "defaults" account, shipped to
      // every user. Programs/workouts/workout_exercises/exercises only. Clients merge
      // these as read-only copies; the merge logic lives in src/data/defaults.ts.
      const DEFAULT_TABLES = ["programs", "workouts", "workout_exercises", "exercises"];
      const defaults = {};
      if (u.id !== defaultsUserId) for (const t of DEFAULT_TABLES) defaults[t] = db.prepare("SELECT data FROM rows WHERE table_name=? AND user_id=? AND deleted=0").all(t, defaultsUserId).map(r => JSON.parse(r.data));
      return json(res, 200, { tables, defaults, defaults_user_id: defaultsUserId });
    }
    if (path === "/api/push" && req.method === "POST") {
      const u = sessionUser(req);
      if (!u) return json(res, 401, { error: "not logged in" });
      const { rows } = await readBody(req);
      const upsert = db.prepare(`
        INSERT INTO rows(table_name,id,user_id,updated_at,deleted,data) VALUES (?,?,?,?,?,?)
        ON CONFLICT(table_name,id) DO UPDATE SET
          updated_at=excluded.updated_at, deleted=excluded.deleted, data=excluded.data, user_id=excluded.user_id
        WHERE excluded.updated_at > rows.updated_at`);
      let applied = 0;
      for (const r of Array.isArray(rows) ? rows : []) {
        if (!TABLES.includes(r.table_name) || typeof r.id !== "string") continue;
        const result = upsert.run(r.table_name, r.id, u.id, String(r.updated_at ?? nowIso()), r.deleted ? 1 : 0, JSON.stringify(r.data));
        applied += result.changes;
      }
      return json(res, 200, { applied });
    }
    if (path === "/api/articles/click" && req.method === "POST") {
      const { slug } = await readBody(req);
      if (typeof slug !== "string" || slug.length > 120) return json(res, 400, { error: "bad slug" });
      db.prepare("INSERT INTO article_clicks(slug,clicks) VALUES (?,1) ON CONFLICT(slug) DO UPDATE SET clicks=clicks+1").run(slug);
      return json(res, 200, {});
    }
    if (path === "/api/articles/popular" && req.method === "GET") {
      const rows = db.prepare("SELECT slug, clicks FROM article_clicks ORDER BY clicks DESC LIMIT 10").all();
      return json(res, 200, { popular: rows });
    }
    if (path.startsWith("/api/")) return json(res, 404, { error: "unknown api route" });
    serveStatic(req, res, path);
  } catch (e) {
    json(res, 500, { error: String(e?.message ?? e) });
  }
});
server.listen(PORT, () => console.log(`RP server on http://0.0.0.0:${PORT} (db: ${DB_PATH})`));