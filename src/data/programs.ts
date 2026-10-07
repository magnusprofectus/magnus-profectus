import { newId } from "./ids";
import { db, type Workout } from "./db";
import * as repo from "./repo";
const meta = () => { const now = new Date().toISOString(); return { user_id: "local", created_at: now, updated_at: now, deleted_at: null, _dirty: 1 as const }; };
export async function createProgram(name: string, firstSplit = "Workout A"): Promise<string> {
  const id = newId();
  await db.transaction("rw", db.programs, db.workouts, async () => {
    const count = await db.programs.count();
    await repo.save(db.programs, { id, ...meta(), name: name.trim() || "New Program", template_key: null, sort: count });
    await repo.save(db.workouts, { id: newId(), ...meta(), program_id: id, name: firstSplit.trim() || "Workout A", position: 0 });
  });
  return id;
}
export async function createWorkout(programId: string, name: string): Promise<Workout> {
  const rows = await db.workouts.where("program_id").equals(programId).toArray();
  const workout: Workout = { id: newId(), ...meta(), program_id: programId, name: name.trim() || `Workout ${rows.length + 1}`, position: rows.length };
  await repo.save(db.workouts, workout);
  return workout;
}
export async function activateProgram(programId: string): Promise<void> {
  const settings = await db.user_settings.get("local");
  if (!settings) return;
  await repo.save(db.user_settings, { ...settings, active_program_id: programId });
}
