// Centralized data access (SPEC §5/§12 shape). All writes go through here so a
// later Supabase sync engine can intercept push/pull in one place.
import { db, type BaseRow, type Exercise, type ExerciseLog, type Program, type Session, type UserSettings, type Workout, type WorkoutExercise } from "./db";
import { newId } from "./ids";
import { pushRow } from "./sync";

export function stamp(): { created_at: string; updated_at: string } {
  const now = new Date().toISOString();
  return { created_at: now, updated_at: now };
}

/** Persist any row: sets updated_at + _dirty, upserts locally. */
export async function save<T extends BaseRow>(table: { put: (row: any) => Promise<unknown>; get: (id: string) => Promise<any>; name: string }, row: T): Promise<T> {
  const next = { ...row, updated_at: new Date().toISOString(), _dirty: 1 } as T;
  await table.put(next);
  pushRow(table.name as never, next.id, next.updated_at, !!next.deleted_at, next as Record<string, unknown>);
  return next;
}

export async function softDelete(table: { get: (id: string) => Promise<any>; put: (row: any) => Promise<unknown>; name: string }, id: string): Promise<void> {
  const row = await table.get(id);
  if (!row) return;
  await save(table, { ...row, deleted_at: new Date().toISOString() });
}

export const live = <T,>(fn: () => Promise<T>) => fn;

// ---- settings ----
export async function getSettings(): Promise<UserSettings | undefined> {
  return db.user_settings.get("local");
}
export async function patchSettings(patch: Partial<UserSettings>): Promise<void> {
  const s = await getSettings();
  if (!s) return;
  await save(db.user_settings, { ...s, ...patch });
}

// ---- exercises ----
export interface ExerciseInput {
  name: string; muscle_group: Exercise["muscle_group"]; equipment: Exercise["equipment"];
  library_key: string | null; setup_notes: string; base_weight: number | null; base_weight_unit: Exercise["base_weight_unit"];
  per_side: boolean; unilateral: boolean; increment: number; increment_unit: Exercise["increment_unit"];
  miniset_count: number; miniset_targets: Array<[number, number]>; total_target_min: number; total_target_max: number;
  rest_seconds: number; safety_flag: boolean; technique_confirmed?: boolean;
}
export async function createExercise(input: ExerciseInput): Promise<Exercise> {
  const ex: Exercise = {
    id: newId(), user_id: "local", ...stamp(), deleted_at: null, _dirty: 1, protocol: "rest_pause",
    technique_confirmed_at: input.technique_confirmed ? new Date().toISOString() : null,
    baseline_reset_at: null, stagnation_dismissed_at: null, archived_at: null,
    ...input,
  };
  await save(db.exercises, ex);
  return ex;
}
export async function updateExercise(exercise: Exercise, patch: Partial<Exercise>): Promise<void> {
  await save(db.exercises, { ...exercise, ...patch });
}
export async function updateExerciseRowPublic(exerciseId: string, patch: Partial<Exercise>): Promise<void> {
  const ex = await db.exercises.get(exerciseId);
  if (ex) await save(db.exercises, { ...ex, ...patch });
}
export async function resetBaseline(exerciseId: string): Promise<void> {
  await updateExerciseRowPublic(exerciseId, { baseline_reset_at: new Date().toISOString() });
}
export async function keepExercise(exerciseId: string): Promise<void> {
  await updateExerciseRowPublic(exerciseId, { stagnation_dismissed_at: new Date().toISOString() });
}

// ---- programs / workouts ----
export async function createBlankProgram(name: string, firstSplit: string): Promise<Program> {
  const count = await db.programs.count();
  const program: Program = { id: newId(), user_id: "local", ...stamp(), deleted_at: null, _dirty: 1, name: name.trim() || "New Program", template_key: null, sort: count };
  await save(db.programs, program);
  await createSplit(program.id, firstSplit);
  return program;
}
/** Clone a program (user-requested 2026-09-30): deep-copies program + splits + links,
 * prompts for a new name. History is keyed by exercise_id, not by program:
 *  - keepHistory=true (default): links point at the SAME exercise rows → all trends,
 *    stagnation counts and "last time" data carry over.
 *  - keepHistory=false: each exercise is DEEP-COPIED into a fresh row (same settings —
 *    name, targets, rest) with baseline_reset_at = now → the clone starts history-free
 *    while the original keeps its own. Use when the clone changes rest/sets/reps
 *    significantly enough that old numbers are no longer comparable. */
export async function cloneProgram(sourceProgramId: string, newName: string, keepHistory = true): Promise<Program> {
  const source = await db.programs.get(sourceProgramId);
  if (!source) throw new Error("Program not found.");
  const count = await db.programs.count();
  const program: Program = { id: newId(), user_id: "local", ...stamp(), deleted_at: null, _dirty: 1, name: newName.trim() || `${source.name} (copy)`, template_key: null, sort: count };
  await save(db.programs, program);
  const exerciseIdMap = new Map<string, string>(); // old exercise id → new (fresh-history) id
  const splits = await db.workouts.where("program_id").equals(sourceProgramId).filter(w => !w.deleted_at).sortBy("position");
  for (const split of splits) {
    const workout: Workout = { id: newId(), user_id: "local", ...stamp(), deleted_at: null, _dirty: 1, program_id: program.id, name: split.name, position: split.position };
    await save(db.workouts, workout);
    const links = await db.workout_exercises.where("workout_id").equals(split.id).filter(x => !x.deleted_at).sortBy("position");
    for (const link of links) {
      let exerciseId = link.exercise_id;
      if (!keepHistory) {
        let mapped = exerciseIdMap.get(exerciseId);
        if (!mapped) {
          const ex = await db.exercises.get(exerciseId);
          if (ex) {
            const now = new Date().toISOString();
            const copy: Exercise = { ...ex, id: newId(), ...stamp(), baseline_reset_at: now, technique_confirmed_at: ex.technique_confirmed_at ?? now };
            await save(db.exercises, copy);
            mapped = copy.id;
            exerciseIdMap.set(exerciseId, mapped);
          }
        }
        if (mapped) exerciseId = mapped;
      }
      const linkCopy: WorkoutExercise = { ...link, id: newId(), workout_id: workout.id, exercise_id: exerciseId, ...stamp() };
      await save(db.workout_exercises, linkCopy);
    }
  }
  return program;
}
export async function createSplit(programId: string, name: string): Promise<Workout> {
  const rows = await db.workouts.where("program_id").equals(programId).toArray();
  const workout: Workout = { id: newId(), user_id: "local", ...stamp(), deleted_at: null, _dirty: 1, program_id: programId, name: name.trim() || `Workout ${rows.length + 1}`, position: rows.length };
  await save(db.workouts, workout);
  return workout;
}
export async function renameWorkout(workoutId: string, name: string): Promise<void> {
  const w = await db.workouts.get(workoutId);
  if (w) await save(db.workouts, { ...w, name });
}
/** Delete a program (soft): program + splits + links. Exercises are shared rows —
 * their history is kept, so deleting a program never erases training history. */
export async function deleteProgram(programId: string): Promise<void> {
  const splits = await db.workouts.where("program_id").equals(programId).filter(w => !w.deleted_at).toArray();
  for (const w of splits) {
    const links = await db.workout_exercises.where("workout_id").equals(w.id).filter(x => !x.deleted_at).toArray();
    for (const link of links) await softDelete(db.workout_exercises, link.id);
    await softDelete(db.workouts, w.id);
  }
  await softDelete(db.programs, programId);
  // if it was active, activate the first remaining program
  const settings = await db.user_settings.get("local");
  if (settings?.active_program_id === programId) {
    const next = await db.programs.filter(p => !p.deleted_at).sortBy("sort");
    if (next[0]) await save(db.user_settings, { ...settings, active_program_id: next[0].id });
  }
}
export async function removeSplit(workoutId: string): Promise<void> {
  await softDelete(db.workouts, workoutId);
  const links = await db.workout_exercises.where("workout_id").equals(workoutId).toArray();
  for (const link of links) await softDelete(db.workout_exercises, link.id);
}
export async function reorderWorkouts(programId: string, orderedIds: string[]): Promise<void> {
  for (const [position, id] of orderedIds.entries()) {
    const w = await db.workouts.get(id);
    if (w) await save(db.workouts, { ...w, position });
  }
  void programId;
}
export async function reorderExercises(workoutId: string, orderedLinkIds: string[]): Promise<void> {
  await db.transaction("rw", db.workout_exercises, async () => {
    for (const [position, id] of orderedLinkIds.entries()) {
      const link = await db.workout_exercises.get(id);
      if (link) await save(db.workout_exercises, { ...link, position });
    }
  });
  void workoutId;
}
/** Set positions to exactly the given order (renumbers 0..n). */
export async function renumberExercises(orderedLinkIds: string[]): Promise<void> {
  await db.transaction("rw", db.workout_exercises, async () => {
    for (const [position, id] of orderedLinkIds.entries()) {
      const link = await db.workout_exercises.get(id);
      if (link && link.position !== position) await save(db.workout_exercises, { ...link, position });
    }
  });
}
export async function addExerciseToWorkout(workoutId: string, exerciseId: string, warmup_mode: WorkoutExercise["warmup_mode"] = "auto"): Promise<WorkoutExercise> {
  const rows = await db.workout_exercises.where("workout_id").equals(workoutId).toArray();
  const row: WorkoutExercise = { id: newId(), user_id: "local", ...stamp(), deleted_at: null, _dirty: 1, workout_id: workoutId, exercise_id: exerciseId, position: rows.length, warmup_mode, replaced_at: null };
  await save(db.workout_exercises, row);
  return row;
}
export async function removeExerciseFromWorkout(linkId: string): Promise<void> {
  await softDelete(db.workout_exercises, linkId);
}
export async function replaceExerciseInWorkout(link: WorkoutExercise, newExerciseId: string): Promise<WorkoutExercise> {
  await save(db.workout_exercises, { ...link, replaced_at: new Date().toISOString() });
  return addExerciseToWorkout(link.workout_id, newExerciseId, link.warmup_mode);
}
export async function setWarmupMode(linkId: string, warmup_mode: WorkoutExercise["warmup_mode"]): Promise<void> {
  const link = await db.workout_exercises.get(linkId);
  if (link) await save(db.workout_exercises, { ...link, warmup_mode });
}

// ---- sessions / logs ----
export async function markLogSkipped(log: ExerciseLog): Promise<void> {
  await saveLogRow(log, { status: "skipped" });
}
export async function setLogRating(log: ExerciseLog, rating: number | null): Promise<void> {
  await saveLogRow(log, { rating });
}
export async function setLogPain(log: ExerciseLog, pain: boolean, pain_note = ""): Promise<void> {
  await saveLogRow(log, { pain, pain_note });
}
export async function setWarmupConfirmed(log: ExerciseLog): Promise<void> {
  await saveLogRow(log, { warmup_confirmed: true });
}
export async function saveLogRow(log: ExerciseLog, patch: Partial<ExerciseLog>): Promise<void> {
  await save(db.exercise_logs, { ...log, ...patch });
  const session = await db.sessions.get(log.session_id);
  if (session) {
    const now = new Date().toISOString();
    await save(db.sessions, { ...session, last_activity_at: now });
  }
}
export async function toggleSessionFlag(session: Session, key: "is_deload" | "is_illness", value: boolean): Promise<void> {
  await save(db.sessions, { ...session, [key]: value });
}
export async function deleteSession(sessionId: string): Promise<void> {
  await softDelete(db.sessions, sessionId);
  const logs = await db.exercise_logs.where("session_id").equals(sessionId).toArray();
  for (const log of logs) await softDelete(db.exercise_logs, log.id);
}

/** User-revised 2026-09: cancel an in-progress session, hard-delete session + logs so
 * nothing is kept (unlike softDelete, which keeps history for the sync/export layer). */
export async function cancelSession(sessionId: string): Promise<void> {
  const logs = await db.exercise_logs.where("session_id").equals(sessionId).toArray();
  for (const log of logs) await softDelete(db.exercise_logs, log.id);
  const session = await db.sessions.get(sessionId);
  if (session) await save(db.sessions, { ...session, deleted_at: new Date().toISOString(), status: "cancelled" });
}
export async function autoFinishStale(maxAgeHours = 3): Promise<void> {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const stale = await db.sessions.filter(s => s.status === "in_progress" && new Date(s.last_activity_at).getTime() < cutoff).toArray();
  for (const s of stale) {
    await save(db.sessions, { ...s, status: "finished", finished_at: s.last_activity_at });
  }
}

// ---- export / import (§9 Data) ----
export interface ExportBundle {
  exported_at: string;
  tables: { user_settings: UserSettings[]; programs: Program[]; workouts: Workout[]; workout_exercises: WorkoutExercise[]; exercises: Exercise[]; sessions: Session[]; exercise_logs: ExerciseLog[] };
}
export async function exportAll(): Promise<ExportBundle> {
  return {
    exported_at: new Date().toISOString(),
    tables: {
      user_settings: await db.user_settings.toArray(),
      programs: await db.programs.toArray(),
      workouts: await db.workouts.toArray(),
      workout_exercises: await db.workout_exercises.toArray(),
      exercises: await db.exercises.toArray(),
      sessions: await db.sessions.toArray(),
      exercise_logs: await db.exercise_logs.toArray(),
    },
  };
}
/** Merge by id, newer updated_at wins (§9). */
export async function importAll(bundle: ExportBundle): Promise<{ merged: number }> {
  let merged = 0;
  const tables = bundle.tables;
  for (const [name, rows] of Object.entries(tables) as Array<[keyof ExportBundle["tables"], BaseRow[]]>) {
    const table = (db as unknown as Record<string, { get: (id: string) => Promise<BaseRow | undefined>; put: (row: BaseRow) => Promise<unknown> }>)[name as string];
    if (!table) continue;
    for (const row of rows) {
      const existing = await table.get(row.id);
      if (!existing || new Date(row.updated_at) > new Date(existing.updated_at)) {
        await table.put(row);
        merged++;
      }
    }
  }
  return { merged };
}
/** CSV export (user-revised 2026-09-30): one row per exercise per session, with
 * human-readable names/date so it opens cleanly in any spreadsheet. Also the exact
 * template shape for CSV import (same columns; session_id/log_id optional-blank). */
export async function exportLogsCsv(): Promise<string> {
  const logs = await db.exercise_logs.filter(x => !x.deleted_at).toArray();
  const sessions = new Map((await db.sessions.filter(s => !s.deleted_at).toArray()).map(s => [s.id, s]));
  const exercises = new Map((await db.exercises.toArray()).map(e => [e.id, e]));
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = "session_date,workout,exercise,weight,unit,partial_set_1,partial_set_2,partial_set_3,partial_set_4,partial_set_5,rating_1to3,pain,pain_note,deload,illness";
  const lines = logs
    .filter(log => log.status === "completed")
    .sort((a, b) => (a.completed_at ?? "").localeCompare(b.completed_at ?? ""))
    .map(log => {
      const s = sessions.get(log.session_id);
      const ex = exercises.get(log.exercise_id);
      return [
        (log.completed_at ?? "").slice(0, 10),
        s?.workout_name_snapshot ?? "",
        ex?.name ?? "",
        log.weight_entered ?? "",
        log.weight_unit,
        ...[0, 1, 2, 3, 4].map(i => log.miniset_reps[i] ?? ""),
        log.rating ?? "",
        log.pain ? "yes" : "no",
        esc(log.pain_note),
        s?.is_deload ? "yes" : "no",
        s?.is_illness ? "yes" : "no",
      ].map(esc).join(",");
    });
  return [header, ...lines].join("\n");
}

/** CSV import (user-revised 2026-09-30): template = the export shape. Creates
 * sessions per unique session_date+workout and exercises by name (custom exercise
 * is created if unknown; per-side detection from unit/name conventions is skipped —
 * user can edit the exercise afterwards). Returns a per-row error report. */
export async function importLogsCsv(csv: string): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  const lines = csv.replace(/\r/g, "").split("\n").filter(l => l.trim());
  if (lines.length < 2) return { imported: 0, skipped: 0, errors: ["File is empty."] };
  const header = lines[0].toLowerCase();
  if (!header.startsWith("session_date,workout,exercise")) return { imported: 0, skipped: 0, errors: ["Unexpected columns. Download the template first, do not rename columns."] };
  const existingExercises = await db.exercises.toArray();
  const byName = new Map(existingExercises.map(e => [e.name.toLowerCase(), e]));
  const sessionsByDate = new Map<string, Session>(); // key: date|workout
  let imported = 0, skipped = 0;
  for (const [idx, line] of lines.slice(1).entries()) {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map(c => c.replace(/,$/, "")).map(c => c.startsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c) ?? [];
    if (cells.length < 6) { skipped++; errors.push(`Row ${idx + 2}: too few columns.`); continue; }
    const [date, workoutName, exName, weight, unit, ...reps] = cells;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; errors.push(`Row ${idx + 2}: session_date must be YYYY-MM-DD.`); continue; }
    if (!exName?.trim()) { skipped++; errors.push(`Row ${idx + 2}: missing exercise name.`); continue; }
    const repsClean = reps.slice(0, 5).map(c => { const n = Number(c); return c.trim() === "" ? null : Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; });
    if (repsClean.every(r => r === null)) { skipped++; errors.push(`Row ${idx + 2}: no reps entered.`); continue; }
    // exercise: find or create a minimal custom exercise
    let ex = byName.get(exName.trim().toLowerCase());
    if (!ex) {
      const now = new Date().toISOString();
      ex = { id: newId(), user_id: "local", created_at: now, updated_at: now, deleted_at: null, _dirty: 1, protocol: "rest_pause", technique_confirmed_at: null, baseline_reset_at: null, stagnation_dismissed_at: null, archived_at: null, name: exName.trim(), muscle_group: "other" as never, equipment: ["other"], library_key: null, setup_notes: "", base_weight: null, base_weight_unit: null, per_side: false, unilateral: false, increment: 2.5, increment_unit: (unit === "lb" ? "lb" : "kg"), miniset_count: Math.max(1, repsClean.filter(r => r !== null).length), miniset_targets: [[5, 7], [3, 5], [2, 4]], total_target_min: 12, total_target_max: 15, rest_seconds: 27, safety_flag: false };
      await save(db.exercises, ex);
      byName.set(exName.trim().toLowerCase(), ex);
    }
    // session: one per date+workout
    const sessKey = `${date}|${workoutName}`;
    let session = sessionsByDate.get(sessKey);
    if (!session) {
      session = await db.sessions.filter(s => !s.deleted_at && s.started_at.slice(0, 10) === date).first();
      if (!session) {
        const now = new Date().toISOString();
        session = { id: newId(), user_id: "local", created_at: now, updated_at: now, deleted_at: null, _dirty: 1, program_id: "", workout_id: "", workout_name_snapshot: workoutName || "Imported", protocol: "rest_pause", started_at: `${date}T12:00:00.000Z`, last_activity_at: now, finished_at: now, status: "finished", is_deload: false, is_illness: false, notes: "imported" };
        await save(db.sessions, session);
      }
      sessionsByDate.set(sessKey, session);
    }
    const now = new Date().toISOString();
    const log: ExerciseLog = { id: newId(), user_id: "local", created_at: now, updated_at: now, deleted_at: null, _dirty: 1, session_id: session.id, exercise_id: ex.id, position: 0, status: "completed", weight_entered: weight === "" ? null : Number(weight), weight_unit: unit === "lb" ? "lb" : "kg", weight_kg: weight === "" ? null : Number(weight) * (unit === "lb" ? 0.45359237 : 1), base_weight_kg_snapshot: ex.base_weight ?? 0, per_side_snapshot: ex.per_side, targets_snapshot: { miniset_targets: ex.miniset_targets, total_min: ex.total_target_min, total_max: ex.total_target_max }, miniset_reps: repsClean, rating: null, pain: false, pain_note: "", warmup_confirmed: true, completed_at: `${date}T12:00:00.000Z`, notes: "imported" };
    await save(db.exercise_logs, log);
    imported++;
  }
  return { imported, skipped, errors };
}
