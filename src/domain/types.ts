// Domain-level types (SPEC §5, §6). Pure data — no Dexie, no React, no Supabase.
// The data layer maps stored rows onto these; session flags are flattened onto the
// log because progression rules need them and domain functions stay single-argument.

export type Unit = "kg" | "lb";

export const LB_PER_KG = 0.45359237;

export type MuscleGroup =
  | "chest"
  | "back"
  | "shoulders"
  | "traps"
  | "biceps"
  | "triceps"
  | "forearms"
  | "quads"
  | "hamstrings_glutes"
  | "calves"
  | "abs";

export type Equipment =
  | "barbell"
  | "dumbbell"
  | "machine"
  | "cable"
  | "bodyweight"
  | "bench"
  | "other";

export type LogStatus = "not_started" | "in_progress" | "completed" | "skipped";

export interface WarmupSchemeEntry {
  pct: number; // fraction of working real load, e.g. 0.5
  reps: number;
}

export interface TargetsSnapshot {
  miniset_targets: Array<[number, number]>;
  total_min: number;
  total_max: number;
}

/** A log as the domain layer sees it: snapshots at log time + flattened session flags. */
export interface DomainLog {
  id: string;
  exercise_id: string;
  status: LogStatus;
  weight_entered: number | null;
  weight_unit: Unit;
  weight_kg: number | null;
  base_weight_kg_snapshot: number;
  per_side_snapshot: boolean;
  miniset_reps: Array<number | null>;
  rating: number | null; // 1 | 1.5 | 2 | 2.5 | 3
  pain: boolean;
  completed_at: string | null; // ISO
  targets_snapshot: TargetsSnapshot;
  // Flattened from the owning session:
  is_deload: boolean;
  is_illness: boolean;
  created_at: string; // ISO, tie-breaker for ordering
}

export interface ExerciseSettings {
  exercise_id: string;
  weight_entered: number; // last/current entry convention value (for recommendations)
  weight_unit: Unit;
  increment: number; // in the entry convention
  increment_unit: Unit;
  base_weight: number | null;
  base_weight_unit: Unit | null;
  per_side: boolean;
  miniset_count: number;
  miniset_targets: Array<[number, number]>;
  total_target_min: number;
  total_target_max: number;
  rest_seconds: number;
  baseline_reset_at: string | null;
  stagnation_dismissed_at: string | null;
}

/** §6.4 classification of one eligible log. */
export type LogClassification =
  | "baseline"
  | "progress"
  | "progress_star"
  | "no_progress";

/** §6.6 colour state vs previous eligible log. */
export type ResultTrend = "improved" | "same" | "regressed";

export interface SessionResult {
  kind: "baseline" | "star" | "trend";
  trend?: ResultTrend; // only when kind === 'trend'
  pct: number | null; // % change vs prev, 1 decimal; null for baseline
}
