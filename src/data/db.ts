import { newId } from "./ids";
import Dexie, { type EntityTable } from "dexie";
import { APP_SLUG, LOCAL_USER_ID } from "../config/app";
import type { Equipment, MuscleGroup, Unit } from "../domain/types";

export interface BaseRow {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  _dirty: 0 | 1;
}
export interface UserSettings extends BaseRow {
  units: Unit;
  theme: "system" | "light" | "dark";
  active_program_id: string | null;
  warmup_reminder_enabled: boolean;
  warmup_scheme: Array<{ pct: number; reps: number }>;
  default_rest_seconds: number;
  progression_window: number;
  gap_reset_weeks: number;
  /** 1 = hide all curated default programs in the Programs tab */
  hide_default_programs?: 0 | 1;
  /** default programs hidden individually from the Programs tab */
  hidden_default_program_ids?: string[];
  /** write a JSON snapshot of the whole store to device Documents (APK) / download (PWA) after each finished workout */
  local_backups?: boolean;
}
export interface Exercise extends BaseRow {
  name: string;
  muscle_group: MuscleGroup;
  equipment: Equipment[];
  library_key: string | null;
  protocol: "rest_pause";
  setup_notes: string;
  base_weight: number | null;
  base_weight_unit: Unit | null;
  per_side: boolean;
  unilateral: boolean;
  increment: number;
  increment_unit: Unit;
  miniset_count: number;
  miniset_targets: Array<[number, number]>;
  total_target_min: number;
  total_target_max: number;
  rest_seconds: number;
  safety_flag: boolean;
  technique_confirmed_at: string | null;
  baseline_reset_at: string | null;
  stagnation_dismissed_at: string | null;
  archived_at: string | null;
}
export interface Program extends BaseRow { name: string; template_key: string | null; sort: number;
  /** curated program shipped from the "defaults" account; read-only, clone to modify */
  is_default?: 0 | 1;
  /** the curator-side program id this copy tracks (for version updates) */
  default_origin_id?: string;
  /** the origin's updated_at at copy time, used to detect upstream changes */
  default_version?: string;
  /** 1 = this copy tracks an older default version (or the default was removed upstream) */
  unmaintained?: 0 | 1;
}
export interface Workout extends BaseRow { program_id: string; name: string; position: number; default_origin_id?: string }
export interface WorkoutExercise extends BaseRow { workout_id: string; exercise_id: string; position: number; warmup_mode: "auto" | "on" | "off"; replaced_at: string | null; default_origin_id?: string }
export interface Session extends BaseRow { program_id: string; workout_id: string; workout_name_snapshot: string; protocol: "rest_pause"; started_at: string; last_activity_at: string; finished_at: string | null; status: "in_progress" | "finished"; is_deload: boolean; is_illness: boolean; notes: string }
export interface ExerciseLog extends BaseRow { session_id: string; exercise_id: string; position: number; status: "not_started" | "in_progress" | "completed" | "skipped"; weight_entered: number | null; weight_unit: Unit; weight_kg: number | null; base_weight_kg_snapshot: number; per_side_snapshot: boolean; targets_snapshot: { miniset_targets: Array<[number, number]>; total_min: number; total_max: number }; miniset_reps: Array<number | null>; rating: number | null; pain: boolean; pain_note: string; warmup_confirmed: boolean; completed_at: string | null; notes: string }

class LocalDatabase extends Dexie {
  user_settings!: EntityTable<UserSettings, "id">;
  exercises!: EntityTable<Exercise, "id">;
  programs!: EntityTable<Program, "id">;
  workouts!: EntityTable<Workout, "id">;
  workout_exercises!: EntityTable<WorkoutExercise, "id">;
  sessions!: EntityTable<Session, "id">;
  exercise_logs!: EntityTable<ExerciseLog, "id">;
  constructor() {
    super(`${APP_SLUG}-${LOCAL_USER_ID}`);
    this.version(13).stores({
      user_settings: "id, user_id, updated_at, _dirty",
      exercises: "id, user_id, name, muscle_group, library_key, archived_at, updated_at, _dirty",
      programs: "id, user_id, template_key, sort, updated_at, _dirty",
      workouts: "id, user_id, program_id, position, updated_at, _dirty",
      workout_exercises: "id, user_id, workout_id, exercise_id, position, updated_at, _dirty",
      sessions: "id, user_id, program_id, workout_id, status, started_at, updated_at, _dirty",
      exercise_logs: "id, user_id, session_id, exercise_id, status, completed_at, updated_at, _dirty",
    });
    // v14: default (curated) programs, same shapes, new optional fields (no index change needed).
    this.version(14).stores({
      user_settings: "id, user_id, updated_at, _dirty",
      exercises: "id, user_id, name, muscle_group, library_key, archived_at, updated_at, _dirty",
      programs: "id, user_id, template_key, sort, is_default, updated_at, _dirty",
      workouts: "id, user_id, program_id, position, updated_at, _dirty",
      workout_exercises: "id, user_id, workout_id, exercise_id, position, updated_at, _dirty",
      sessions: "id, user_id, program_id, workout_id, status, started_at, updated_at, _dirty",
      exercise_logs: "id, user_id, session_id, exercise_id, status, completed_at, updated_at, _dirty",
    });
  }
}
export const db = new LocalDatabase();

export function newRow<T extends object>(fields: T): T & BaseRow {
  const now = new Date().toISOString();
  return { ...fields, id: newId(), user_id: LOCAL_USER_ID, created_at: now, updated_at: now, deleted_at: null, _dirty: 1 };
}

export async function writeRecord<T extends BaseRow>(table: EntityTable<T, "id">, row: T): Promise<void> {
  const updated = { ...row, updated_at: new Date().toISOString(), _dirty: 1 as const };
  await table.put(updated);
}
