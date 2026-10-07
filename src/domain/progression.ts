// Eligibility, baselines, progression, and stagnation (SPEC §6.3–6.5).
import type { DomainLog, ExerciseSettings, LogClassification } from "./types";
import { cappedReps, isRepsOnly, metric, realLoadPerRepKg, totalReps } from "./load";

export function isEligible(log: DomainLog): boolean {
  return log.status === "completed" && !log.pain && !log.is_deload && !log.is_illness;
}

function time(log: DomainLog): number {
  return new Date(log.completed_at ?? log.created_at).getTime();
}

export function orderedLogs(logs: DomainLog[]): DomainLog[] {
  return [...logs].sort((a, b) => time(a) - time(b) || a.id.localeCompare(b.id));
}

export interface ClassifiedLog {
  log: DomainLog;
  status: LogClassification | "ineligible";
}

/** Classify all logs in chronological order; baseline boundaries reset comparisons. */
export function classifyLogs(
  source: DomainLog[],
  settings: Pick<ExerciseSettings, "baseline_reset_at">,
  progressionWindow = 3,
  gapResetWeeks = 4,
): ClassifiedLog[] {
  const all = orderedLogs(source);
  const eligible = all.filter(isEligible);
  const results = new Map<string, LogClassification>();
  let priorEligible: DomainLog | undefined;
  let baseline: DomainLog | undefined;

  for (const log of eligible) {
    const t = time(log);
    const prevCompleted = all.filter(x => x.exercise_id === log.exercise_id && x.status === "completed" && time(x) < t).at(-1);
    const reset = settings.baseline_reset_at ? new Date(settings.baseline_reset_at).getTime() : null;
    const gapMs = gapResetWeeks * 7 * 24 * 60 * 60 * 1000;
    const isBaseline = !priorEligible || (!!prevCompleted && t - time(prevCompleted) > gapMs) || (!!reset && t > reset && (!priorEligible || time(priorEligible) <= reset));
    if (isBaseline) {
      results.set(log.id, "baseline");
      baseline = log;
      priorEligible = log;
      continue;
    }

    const priorWindow = eligible
      .filter(x => time(x) < t && (!baseline || time(x) >= time(baseline)))
      .slice(-progressionWindow);
    const prev = priorEligible!;
    const reps = cappedReps(log);
    const newBest = metric(log) > Math.max(...priorWindow.map(metric));
    const star = !isRepsOnly(log) && realLoadPerRepKg(log) > realLoadPerRepKg(prev) && totalReps(log) >= log.targets_snapshot.total_min;
    const comparable = priorWindow.filter(x => realLoadPerRepKg(x) >= realLoadPerRepKg(log));
    const moreReps = comparable.length > 0 && reps > Math.max(...comparable.map(cappedReps));
    results.set(log.id, newBest ? "progress" : star ? "progress_star" : moreReps ? "progress" : "no_progress");
    priorEligible = log;
  }

  return all.map(log => ({ log, status: isEligible(log) ? (results.get(log.id) ?? "baseline") : "ineligible" }));
}

export function stagnationCount(
  logs: DomainLog[],
  settings: Pick<ExerciseSettings, "baseline_reset_at" | "stagnation_dismissed_at">,
  progressionWindow = 3,
  gapResetWeeks = 4,
): number {
  const classified = classifyLogs(logs, settings, progressionWindow, gapResetWeeks)
    .filter(x => x.status !== "ineligible");
  const dismissed = settings.stagnation_dismissed_at ? new Date(settings.stagnation_dismissed_at).getTime() : -Infinity;
  let count = 0;
  for (const row of classified.reverse()) {
    if (time(row.log) <= dismissed) break;
    if (row.status === "no_progress") count++;
    else break;
  }
  return count;
}
