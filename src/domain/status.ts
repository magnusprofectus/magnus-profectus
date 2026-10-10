// Session-result display state (SPEC §6.6).
import type { DomainLog, SessionResult } from "./types";
import { cappedReps, isRepsOnly, metric, totalReps } from "./load";

export function compareResult(current: DomainLog, previous: DomainLog | null, isBaseline: boolean): SessionResult {
  if (isBaseline || !previous) return { kind: "baseline", pct: null };
  const a = isRepsOnly(current) ? cappedReps(current) : metric(current);
  const b = isRepsOnly(previous) ? cappedReps(previous) : metric(previous);
  const pct = b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10;
  // One gold star for ANY total-load progression (more reps at the same weight or
  // a heavier weight), never for a weight jump that collapsed reps below the
  // target floor, and never for deload/illness/pain-flagged sessions.
  const flagged = (current as { is_deload?: boolean; is_illness?: boolean; pain?: boolean });
  const repsOk = totalReps(current) >= current.targets_snapshot.total_min;
  if (a > b && repsOk && !flagged.is_deload && !flagged.is_illness && !flagged.pain) return { kind: "star", pct };
  if (a < b) return { kind: "trend", trend: "regressed", pct };
  return { kind: "trend", trend: "same", pct: null };
}
