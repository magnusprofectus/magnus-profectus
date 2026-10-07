// Load metric (SPEC §6.2). Pure functions.
import type { DomainLog } from "./types";

/** Real load moved per rep, in kg, honouring the per-side convention. */
export function realLoadPerRepKg(log: Pick<DomainLog, "weight_kg" | "base_weight_kg_snapshot" | "per_side_snapshot">): number {
  return (
    log.base_weight_kg_snapshot +
    (log.weight_kg ?? 0) * (log.per_side_snapshot ? 2 : 1)
  );
}

/** Sum of entered mini-set reps (nulls ignored — for live entry before completion). */
export function totalReps(log: Pick<DomainLog, "miniset_reps">): number {
  return log.miniset_reps.reduce<number>(
    (acc, r) => acc + (r === null ? 0 : r),
    0,
  );
}

export function cappedReps(log: Pick<DomainLog, "miniset_reps" | "targets_snapshot">): number {
  return Math.min(totalReps(log), log.targets_snapshot.total_max);
}

/** True when there is no real load (e.g. bodyweight entered as 0 with no base weight). */
export function isRepsOnly(log: Pick<DomainLog, "weight_kg" | "base_weight_kg_snapshot" | "per_side_snapshot">): boolean {
  return realLoadPerRepKg(log) === 0;
}

/**
 * The single progress metric (SPEC §6.2): capped load in kg, or capped reps in
 * reps-only mode. Callers label reps-only mode "reps" instead of kg/lb.
 */
export function cappedLoadKg(log: Pick<DomainLog, "weight_kg" | "base_weight_kg_snapshot" | "per_side_snapshot" | "miniset_reps" | "targets_snapshot">): number {
  return realLoadPerRepKg(log) * cappedReps(log);
}

/** Metric used for comparisons: load in kg, or capped reps in reps-only mode. */
export function metric(log: DomainLog): number {
  return isRepsOnly(log) ? cappedReps(log) : cappedLoadKg(log);
}
