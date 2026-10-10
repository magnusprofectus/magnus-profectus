import { newId } from "./ids";
import { db, type UserSettings, type WorkoutExercise } from "./db";
import { equipmentIncrement } from "./library";
import { libraryItem, programTemplates } from "./templates";
import type { Unit } from "../domain/types";

let seeding: Promise<void> | null = null;
/** Re-run the seed even if it already ran this session. Needed after a login pull:
 * pull() clears Dexie, and the memoized ensureSeeded() from app boot would no-op,
 * leaving brand-new accounts empty (no starter program, no settings). */
export async function reseed(): Promise<void> { seeding = null; await ensureSeeded(); }
export function ensureSeeded(): Promise<void> {
  if (!seeding) seeding = seedOnce().catch(error => { seeding = null; throw error; });
  return seeding;
}

/** Idempotent seed: safe under StrictMode, HMR, and interrupted prior writes. */
async function seedOnce(): Promise<void> {
  for (const template of programTemplates) await seedTemplate(template);
}

async function seedTemplate(template: (typeof programTemplates)[number]): Promise<void> {
  let program = await db.programs.where("template_key").equals(template.key).first();
  // Legacy migration (2026-10-07): installs created before the default program was
  // rebuilt carry name "My Program" and old split contents. If the user never
  // renamed it (still exactly "My Program"), soft-delete its splits and links and
  // fall through to a fresh build from the template. Renamed/customized copies stay.
    // Rebuild condition covers both legacy names ("My Program") and installs that
  // already migrated to "Default Program" but still carry the old generic split
  // names, provided the user never renamed a split themselves.
  const LEGACY_SPLIT_NAMES = new Set(["Workout A", "Workout B", "Workout C"]);
  if (template === programTemplates[0] && program) {
    const owned = (await db.workouts.where("program_id").equals(program.id).toArray()).filter(w => !w.deleted_at);
    const untouchedSplits = owned.length > 0 && owned.every(w => LEGACY_SPLIT_NAMES.has(w.name));
    if (program.name === "My Program" || (program.name === "Default Program" && untouchedSplits)) {
    const now = new Date().toISOString();
    const oldWorkouts = await db.workouts.where("program_id").equals(program.id).toArray();
    for (const w of oldWorkouts) {
      const links = await db.workout_exercises.where("workout_id").equals(w.id).toArray();
      for (const l of links) await db.workout_exercises.put({ ...l, deleted_at: now, updated_at: now, _dirty: 1 as const });
      await db.workouts.put({ ...w, deleted_at: now, updated_at: now, _dirty: 1 as const });
    }
    await db.programs.put({ ...program, name: template.name, updated_at: now, _dirty: 1 as const });
    program = { ...program, name: template.name };
    }
  }
  if (!program) {
    const now = new Date().toISOString();
    program = { id: newId(), user_id: "local", created_at: now, updated_at: now, deleted_at: null, _dirty: 1, name: template.name, template_key: template.key, sort: 0 };
    await db.programs.put(program);
  }

  const settings = await db.user_settings.get("local");
  if (!settings) {
    const now = new Date().toISOString();
    const row: UserSettings = { id: "local", user_id: "local", created_at: now, updated_at: now, deleted_at: null, _dirty: 1, units: "kg", theme: "system", active_program_id: program.id, warmup_reminder_enabled: true, warmup_scheme: [{ pct: 0.5, reps: 15 }, { pct: 0.75, reps: 7 }, { pct: 0.9, reps: 3 }], default_rest_seconds: 27, progression_window: 3, gap_reset_weeks: 4 };
    await db.user_settings.put(row);
  }

  for (const [wi, wt] of template.workouts.entries()) {
    let workout = await db.workouts.where("program_id").equals(program.id).filter(w => w.name === wt.name).first();
    if (!workout) {
      const now = new Date().toISOString();
      workout = { id: newId(), user_id: "local", created_at: now, updated_at: now, deleted_at: null, _dirty: 1, program_id: program.id, name: wt.name, position: wi };
      await db.workouts.put(workout);
    }
    for (const [pos, spec] of wt.exercises.entries()) {
      if (spec.custom) {
        const c = spec.custom;
        let custom = (await db.exercises.toArray()).find(e => !e.deleted_at && e.name.toLowerCase() === c.name.toLowerCase());
        if (!custom) {
          const now = new Date().toISOString();
          const primary = c.equipment[0] as keyof typeof equipmentIncrement;
          const row = {
            id: newId(), user_id: "local", created_at: now, updated_at: now, deleted_at: null, _dirty: 1 as const,
            name: c.name, muscle_group: c.muscle_group as never, equipment: c.equipment as never, library_key: null, protocol: "rest_pause" as const, setup_notes: "",
            base_weight: null, base_weight_unit: null, per_side: !!c.unilateral, unilateral: !!c.unilateral,
            increment: equipmentIncrement[primary]?.kg ?? 2, increment_unit: "kg" as const, miniset_count: 3,
            miniset_targets: [[5, 7], [3, 5], [2, 4]], total_target_min: 12, total_target_max: 15,
            rest_seconds: 27, safety_flag: false, technique_confirmed_at: null,
          };
          await db.exercises.put(row as never);
          custom = row as never;
        }
        const existingLink = await db.workout_exercises.where("workout_id").equals(workout!.id).filter(row => row.exercise_id === custom.id && !row.replaced_at).first();
        if (!existingLink) {
          const now = new Date().toISOString();
          const row: WorkoutExercise = { id: newId(), user_id: "local", created_at: now, updated_at: now, deleted_at: null, _dirty: 1, workout_id: workout!.id, exercise_id: custom.id, position: pos, warmup_mode: "auto", replaced_at: null };
          await db.workout_exercises.put(row);
        }
        continue;
      }
      const item = libraryItem(spec.key!);
      if (!item) continue;
      let exercise = await db.exercises.where("library_key").equals(item.key).first();
      if (!exercise) {
        const now = new Date().toISOString();
        const unit: Unit = "kg";
        const primary = item.equipment[0];
        exercise = {
          id: newId(), user_id: "local", created_at: now, updated_at: now, deleted_at: null, _dirty: 1,
          name: item.name, muscle_group: item.muscle_group, equipment: item.equipment, library_key: item.key, protocol: "rest_pause", setup_notes: "",
          base_weight: null, base_weight_unit: null, per_side: false, unilateral: !!item.unilateral,
          increment: equipmentIncrement[primary].kg, increment_unit: unit, miniset_count: 3,
          miniset_targets: [[5, 7], [3, 5], [2, 4]], total_target_min: 12, total_target_max: 15, rest_seconds: 27,
          safety_flag: !!item.safety_flag, technique_confirmed_at: now, baseline_reset_at: null, stagnation_dismissed_at: null, archived_at: null,
        };
        await db.exercises.put(exercise);
      }
      const link = await db.workout_exercises.where("workout_id").equals(workout.id).filter(row => row.exercise_id === exercise!.id && !row.replaced_at).first();
      if (!link) {
        const now = new Date().toISOString();
        const row: WorkoutExercise = { id: newId(), user_id: "local", created_at: now, updated_at: now, deleted_at: null, _dirty: 1, workout_id: workout.id, exercise_id: exercise.id, position: pos, warmup_mode: spec.warmup_mode ?? "auto", replaced_at: null };
        await db.workout_exercises.put(row);
      }
    }
  }
}
