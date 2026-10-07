// Session-result display state (SPEC §6.6).
import type { DomainLog, SessionResult } from "./types";
import { cappedReps, isRepsOnly, metric, realLoadPerRepKg, totalReps } from "./load";

export function compareResult(current: DomainLog, previous: DomainLog | null, isBaseline: boolean): SessionResult {
  if (isBaseline || !previous) return { kind: "baseline", pct: null };
  const star = !isRepsOnly(current) && realLoadPerRepKg(current) > realLoadPerRepKg(previous) && totalReps(current) >= current.targets_snapshot.total_min;
  if (star) {
    const oldMetric = metric(previous);
    const pct = oldMetric === 0 ? null : Math.round(((metric(current) - oldMetric) / oldMetric) * 1000) / 10;
    return { kind: "star", pct };
  }
  const a = isRepsOnly(current) ? cappedReps(current) : metric(current);
  const b = isRepsOnly(previous) ? cappedReps(previous) : metric(previous);
  const trend = a > b ? "improved" : a < b ? "regressed" : "same";
  const pct = b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10;
  return { kind: "trend", trend, pct };
}
