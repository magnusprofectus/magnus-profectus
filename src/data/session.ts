import { newId } from "./ids";
import { db, type Exercise, type ExerciseLog, type Session, type Workout } from "./db";
import * as repo from "./repo";
import { pushRow } from "./sync";
const syncPush = (row: ExerciseLog) => { const { _dirty, ...data } = row; pushRow("exercise_logs", row.id, data.updated_at as string, !!data.deleted_at, data as Record<string, unknown>); };

export async function startOrResumeSession(programId: string, workout: Workout, exercises: Exercise[]): Promise<Session> {
  const existing = await db.sessions.where("status").equals("in_progress").and(row => row.workout_id === workout.id && !row.deleted_at).first();
  if (existing) return existing;
  const now = new Date().toISOString();
  const session: Session = { id: newId(), user_id: "local", created_at: now, updated_at: now, deleted_at: null, _dirty: 1, program_id: programId, workout_id: workout.id, workout_name_snapshot: workout.name, protocol: "rest_pause", started_at: now, last_activity_at: now, finished_at: null, status: "in_progress", is_deload: false, is_illness: false, notes: "" };
  await repo.save(db.sessions, session);
  const links = await db.workout_exercises.where("workout_id").equals(workout.id).filter(row => !row.replaced_at).sortBy("position");
  const logs: ExerciseLog[] = links.flatMap((link, position) => {
    const ex = exercises.find(item => item.id === link.exercise_id);
    if (!ex) return [];
    const row: ExerciseLog = { id: newId(), user_id: "local", created_at: now, updated_at: now, deleted_at: null, _dirty: 1, session_id: session.id, exercise_id: ex.id, position, status: "not_started", weight_entered: null, weight_unit: ex.increment_unit, weight_kg: null, base_weight_kg_snapshot: ex.base_weight === null ? 0 : ex.base_weight * (ex.base_weight_unit === "lb" ? 0.45359237 : 1), per_side_snapshot: ex.per_side, targets_snapshot: { miniset_targets: ex.miniset_targets, total_min: ex.total_target_min, total_max: ex.total_target_max }, miniset_reps: Array(ex.miniset_count).fill(null), rating: null, pain: false, pain_note: "", warmup_confirmed: false, completed_at: null, notes: "" };
    return [row];
  });
  await db.exercise_logs.bulkPut(logs);
  for (const log of logs) syncPush(log);
  return session;
}

export async function finishSession(session: Session): Promise<void> {
  const finishedAt = new Date().toISOString();
  await repo.save(db.sessions, { ...session, status: "finished", finished_at: finishedAt, last_activity_at: finishedAt });
}

export async function updateMinisetRep(logId: string, index: number, reps: number | null): Promise<void> {
  const log = await db.exercise_logs.get(logId);
  if (!log || index < 0 || index >= log.miniset_reps.length) return;
  const miniset_reps = [...log.miniset_reps];
  miniset_reps[index] = reps;
  const weight_entered = log.weight_entered;
  const complete = weight_entered !== null && miniset_reps.length > 0 && miniset_reps.every(value => value !== null);
  await saveLog(log, { miniset_reps, status: complete ? "completed" : "in_progress", completed_at: complete ? (log.completed_at ?? new Date().toISOString()) : null });
}

export async function saveLog(log: ExerciseLog, patch: Partial<ExerciseLog>): Promise<void> {
  await db.transaction("rw", db.exercise_logs, db.sessions, async () => {
    const latest = await db.exercise_logs.get(log.id);
    if (!latest) return;
    const timestamp = new Date().toISOString();
    const updated: ExerciseLog = { ...latest, ...patch, updated_at: timestamp, _dirty: 1 };
    await db.exercise_logs.put(updated);
    syncPush(updated);
    const session = await db.sessions.get(log.session_id);
    if (session) await repo.save(db.sessions, { ...session, last_activity_at: timestamp });
  });
}
