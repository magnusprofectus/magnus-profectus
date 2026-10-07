// Default (curated) programs: merge logic. The server "defaults" account is the
// curator; its programs/workouts/workout_exercises/exercises ship in every bundle
// (server/index.mjs /api/bundle `defaults`). Local copies get is_default=1 and a
// default_origin_id; users cannot edit them (clone to modify). When the curator
// changes a program upstream, the local copy is marked unmaintained=1 (still visible,
// labelled "older version") and a fresh copy of the new version is added. When the
// curator deletes a program upstream, the local copy is marked unmaintained=1 only.
import { db, type Program, type Workout, type WorkoutExercise, type Exercise } from "./db";
import * as repo from "./repo";
import { newId } from "./ids";

export const DEFAULTS_USERNAME = "defaults";

const now = () => new Date().toISOString();
const meta = () => ({ user_id: "local", created_at: now(), updated_at: now(), deleted_at: null, _dirty: 1 as const });

type Bundle = { programs: Program[]; workouts: Workout[]; workout_exercises: WorkoutExercise[]; exercises: Exercise[] };

/** Merge the defaults bundle from the server into local read-only copies. */
export async function mergeDefaults(defaults: Bundle | undefined, myUserId: string | undefined, defaultsUserId: string | undefined) {
  if (!defaults?.programs?.length && !defaults?.workouts?.length) return;
  if (defaultsUserId && myUserId === defaultsUserId) return; // the curator doesn't copy itself

  const localDefaults = (await db.programs.where("is_default").equals(1).toArray()).filter(p => !p.deleted_at);
  const originVersion = new Map(localDefaults.filter(p => p.default_origin_id).map(p => [p.default_origin_id as string, p]));
  const seen = new Set<string>();

  for (const sp of defaults.programs) {
    if (sp.deleted_at) continue;
    seen.add(sp.id);
    const version = contentVersion(sp, defaults);
    const local = originVersion.get(sp.id);
    if (local && local.default_version === version) continue; // unchanged
    if (local && local.default_version !== version) {
      // upstream changed: ship the change silently into the existing copy
      // (announcements happen out-of-band). Only upstream DELETION unmaintains.
      await updateVersion(local, sp, defaults, version);
      continue;
    }
    await insertVersion(sp, defaults, version);
  }

  // upstream deleted (or curator account empty): mark local copies unmaintained, keep visible
  for (const lp of localDefaults) {
    if (!lp.default_origin_id || seen.has(lp.default_origin_id)) continue;
    if (!lp.unmaintained) await repo.save(db.programs, { ...lp, unmaintained: 1, updated_at: now() });
  }
}

/** effective version of a default program: its own updated_at plus the newest
 * updated_at of its workouts and workout-exercise links, so sub-row edits
 * (adding an exercise, renaming a split) count as changes even though the
 * program row itself is untouched. */
function contentVersion(sp: Program, bundle: Bundle): string {
  const times = [sp.updated_at ?? ""];
  for (const w of bundle.workouts ?? []) if (w.program_id === sp.id) { times.push(w.updated_at ?? ""); for (const l of bundle.workout_exercises ?? []) if (l.workout_id === w.id) times.push(l.updated_at ?? ""); }
  return times.sort().at(-1) ?? "";
}

async function insertVersion(sp: Program, bundle: Bundle, version: string) {
  const exMap = new Map<string, string>();
  for (const se of bundle.exercises ?? []) {
    // map curator exercise -> local exercise: reuse by library_key if present, else insert
    const key = (se as { library_key?: string }).library_key;
    let target: Exercise | undefined;
    if (key) target = (await db.exercises.where("library_key").equals(key).toArray()).find(e => !e.deleted_at);
    if (!target) {
      target = { ...se, ...meta(), id: newId(), _dirty: 1 } as Exercise;
      await repo.save(db.exercises, target);
    }
    exMap.set(se.id, target.id);
  }
  const wMap = new Map<string, string>();
  const program = { ...sp, ...meta(), id: newId(), is_default: 1 as const, default_origin_id: sp.id, default_version: version, unmaintained: 0 as const } as Program;
  await repo.save(db.programs, program);
  const workouts = (bundle.workouts ?? []).filter(w => w.program_id === sp.id && !w.deleted_at).sort((a, b) => a.position - b.position);
  for (const sw of workouts) {
    const w = { ...sw, ...meta(), id: newId(), program_id: program.id, default_origin_id: sw.id } as Workout;
    await repo.save(db.workouts, w);
    wMap.set(sw.id, w.id);
    const links = (bundle.workout_exercises ?? []).filter(l => l.workout_id === sw.id && !l.deleted_at && !l.replaced_at).sort((a, b) => a.position - b.position);
    for (const sl of links) {
      const exerciseId = exMap.get(sl.exercise_id);
      if (!exerciseId) continue;
      await repo.save(db.workout_exercises, { ...sl, ...meta(), id: newId(), workout_id: w.id, exercise_id: exerciseId, default_origin_id: sl.id } as WorkoutExercise);
    }
  }
}

/** Ship upstream changes into an existing default copy, silently. Workouts and
 * workout-exercise links are matched by default_origin_id: updated in place, added
 * if new, removed if gone upstream. Exercise ROWS are shared library entities and
 * are never touched here (remap only), so user history stays intact. */
async function updateVersion(local: Program, sp: Program, bundle: Bundle, version: string) {
  await repo.save(db.programs, { ...local, name: sp.name, sort: sp.sort, default_version: version, unmaintained: 0 as const, updated_at: now() });
  const upstreamWorkouts = (bundle.workouts ?? []).filter(w => w.program_id === sp.id && !w.deleted_at).sort((a, b) => a.position - b.position);
  const upstreamIds = new Set(upstreamWorkouts.map(w => w.id));
  const localWorkouts = (await db.workouts.where("program_id").equals(local.id).toArray()).filter(w => !w.deleted_at);
  // remove workouts (and their links) that disappeared upstream
  for (const lw of localWorkouts) {
    if (lw.default_origin_id && !upstreamIds.has(lw.default_origin_id)) {
      const links = await db.workout_exercises.where("workout_id").equals(lw.id).toArray();
      await db.transaction("rw", db.workout_exercises, db.workouts, async () => {
        for (const l of links) await repo.softDelete(db.workout_exercises, l.id);
        await repo.softDelete(db.workouts, lw.id);
      });
    }
  }
  for (const [position, sw] of upstreamWorkouts.entries()) {
    // legacy copies (pre origin-stamping) have no ids to match on; fall back to name
    let lw = localWorkouts.find(w => w.default_origin_id === sw.id) ?? localWorkouts.find(w => !w.default_origin_id && w.name === sw.name);
    if (lw && !lw.default_origin_id) { await repo.save(db.workouts, { ...lw, default_origin_id: sw.id, updated_at: now() }); lw = { ...lw, default_origin_id: sw.id }; }
    if (!lw) {
      lw = { ...sw, ...meta(), id: newId(), program_id: local.id, default_origin_id: sw.id } as Workout;
      await repo.save(db.workouts, lw);
    } else if (lw.name !== sw.name || lw.position !== position) {
      await repo.save(db.workouts, { ...lw, name: sw.name, position, updated_at: now() });
    }
    const upstreamLinks = (bundle.workout_exercises ?? []).filter(l => l.workout_id === sw.id && !l.deleted_at && !l.replaced_at).sort((a, b) => a.position - b.position);
    const upstreamLinkIds = new Set(upstreamLinks.map(l => l.id));
    const localLinks = (await db.workout_exercises.where("workout_id").equals(lw.id).toArray()).filter(l => !l.deleted_at && !l.replaced_at);
    for (const ll of localLinks) {
      if (ll.default_origin_id && !upstreamLinkIds.has(ll.default_origin_id)) await repo.softDelete(db.workout_exercises, ll.id);
    }
    const consumed = new Set<string>();
    for (const [pos, sl] of upstreamLinks.entries()) {
      const exerciseId = await resolveExercise(sl.exercise_id, bundle);
      if (!exerciseId) continue;
      // match by origin id first; legacy links (no origin) fall back to exercise match
      let existing = localLinks.find(l => l.default_origin_id === sl.id);
      if (!existing) existing = localLinks.find(l => !l.default_origin_id && l.exercise_id === exerciseId && !consumed.has(l.id));
      if (existing) consumed.add(existing.id);
      if (existing && !existing.default_origin_id) { await repo.save(db.workout_exercises, { ...existing, default_origin_id: sl.id, updated_at: now() }); }
      else if (existing) { /* keep */ }
      if (!existing) {
        await repo.save(db.workout_exercises, { ...sl, ...meta(), id: newId(), workout_id: lw!.id, exercise_id: exerciseId, default_origin_id: sl.id } as WorkoutExercise);
      } else if (existing.exercise_id !== exerciseId || existing.position !== pos || existing.warmup_mode !== sl.warmup_mode) {
        await repo.save(db.workout_exercises, { ...existing, exercise_id: exerciseId, position: pos, warmup_mode: sl.warmup_mode, updated_at: now() });
      }
    }
  }
}

/** map a curator exercise to a local exercise id (reuse by library_key, else insert) */
async function resolveExercise(originExerciseId: string, bundle: Bundle): Promise<string | null> {
  const se = (bundle.exercises ?? []).find(e => e.id === originExerciseId);
  if (!se) return null;
  const key = (se as { library_key?: string }).library_key;
  if (key) {
    const found = (await db.exercises.where("library_key").equals(key).toArray()).find(e => !e.deleted_at);
    if (found) return found.id;
  }
  const inserted = { ...se, ...meta(), id: newId(), _dirty: 1 } as Exercise;
  await repo.save(db.exercises, inserted);
  return inserted.id;
}