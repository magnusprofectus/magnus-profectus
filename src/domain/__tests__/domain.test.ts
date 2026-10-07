import { describe, expect, it } from "vitest";
import {
  calculateWarmups,
  cappedLoadKg,
  classifyLogs,
  compareResult,
  displayValue,
  recommendWeight,
  orderWorkoutsByRecency,
  stagnationCount,
  type DomainLog,
  type ExerciseSettings,
  type WarmupSchemeEntry,
} from "../index";

const targets = { miniset_targets: [[5, 7], [3, 5], [2, 4]] as Array<[number, number]>, total_min: 12, total_max: 15 };
const settings: ExerciseSettings = {
  exercise_id: "e1", weight_entered: 100, weight_unit: "kg", increment: 2.5, increment_unit: "kg",
  base_weight: null, base_weight_unit: null, per_side: false, miniset_count: 3,
  miniset_targets: targets.miniset_targets, total_target_min: 12, total_target_max: 15,
  rest_seconds: 27, baseline_reset_at: null, stagnation_dismissed_at: null,
};
function log(n: number, weight: number, reps: Array<number | null>, opts: Partial<DomainLog> = {}): DomainLog {
  return {
    id: `s${n}`, exercise_id: "e1", status: "completed", weight_entered: weight, weight_unit: "kg", weight_kg: weight,
    base_weight_kg_snapshot: 0, per_side_snapshot: false, miniset_reps: reps, rating: 2, pain: false,
    completed_at: `2026-01-${String(n).padStart(2, "0")}T10:00:00.000Z`, created_at: `2026-01-${String(n).padStart(2, "0")}T10:00:00.000Z`,
    targets_snapshot: targets, is_deload: false, is_illness: false, ...opts,
  };
}
const S1 = log(1, 100, [6, 4, 3]);
const S2 = log(2, 100, [7, 4, 3]);
const S3 = log(3, 100, [7, 5, 4]);
const S4 = log(4, 102.5, [6, 4, 3]);
const S5 = log(5, 102.5, [6, 4, 4]);
const S6 = log(6, 102.5, [6, 4, 4]);
const S7 = log(7, 102.5, [6, 4, 3]);
const S8 = log(8, 100, [6, 4, 3], { completed_at: "2026-03-01T10:00:00.000Z", created_at: "2026-03-01T10:00:00.000Z" });

describe("SPEC §6.11 progression sequence", () => {
  const rows = classifyLogs([S1, S2, S3, S4, S5, S6, S7, S8], settings, 3, 4);
  it("computes capped loads and statuses S1–S8", () => {
    expect([S1, S2, S3, S4, S5, S6, S7, S8].map(cappedLoadKg)).toEqual([1300, 1400, 1500, 1332.5, 1435, 1435, 1332.5, 1300]);
    expect(rows.map(x => x.status)).toEqual(["baseline", "progress", "progress", "progress_star", "progress", "no_progress", "no_progress", "baseline"]);
  });
  it("classifies session result trend and star", () => {
    expect(compareResult(S1, null, true)).toEqual({ kind: "baseline", pct: null });
    expect(compareResult(S2, S1, false)).toEqual({ kind: "trend", trend: "improved", pct: 7.7 });
    expect(compareResult(S4, S3, false).kind).toBe("star");
  });
  it("counts stagnation and resets after gap baseline", () => {
    expect(stagnationCount([S1, S2, S3, S4, S5, S6], settings)).toBe(1);
    expect(stagnationCount([S1, S2, S3, S4, S5, S6, S7], settings)).toBe(2);
    expect(rows.at(-1)?.status).toBe("baseline");
    expect(stagnationCount([S1, S2, S3, S4, S5, S6, S7, S8], settings)).toBe(0);
  });
  it("recommends a weight direction per ordered rule", () => {
    expect(recommendWeight([S1], settings).direction).toBe("keep_same");
    expect(recommendWeight([S3], settings).direction).toBe("increase");
    expect(recommendWeight([S4], settings).direction).toBe("keep_same");
    expect(recommendWeight([], settings).direction).toBe("no_history");
    const tooFew = log(9, 100, [4, 3, 2]);
    expect(recommendWeight([tooFew], settings).direction).toBe("decrease");
    const easy = log(10, 100, [6, 4, 3], { rating: 1.5 });
    expect(recommendWeight([easy], settings).direction).toBe("increase");
  });
});

describe("eligibility and baseline edge cases", () => {
  it("excludes pain, deload, illness, skipped and in-progress logs", () => {
    const bad = [
      log(2, 100, [7, 4, 3], { pain: true }),
      log(3, 100, [7, 4, 3], { is_deload: true }),
      log(4, 100, [7, 4, 3], { is_illness: true }),
      log(5, 100, [7, 4, 3], { status: "skipped" }),
      log(6, 100, [7, 4, 3], { status: "in_progress" }),
    ];
    expect(classifyLogs([S1, ...bad], settings).map(x => x.status)).toEqual(["baseline", "ineligible", "ineligible", "ineligible", "ineligible", "ineligible"]);
    expect(stagnationCount([S1, ...bad], settings)).toBe(0);
  });
  it("manual reset makes the first subsequent eligible log a baseline", () => {
    const reset = { ...settings, baseline_reset_at: "2026-01-01T11:00:00.000Z" };
    expect(classifyLogs([S1, S2], reset).map(x => x.status)).toEqual(["baseline", "baseline"]);
  });
  it("keep-exercise dismissal clears earlier stagnation", () => {
    const dismissed = { ...settings, stagnation_dismissed_at: S5.completed_at };
    expect(stagnationCount([S1, S2, S3, S4, S5, S6, S7], dismissed)).toBe(2);
    expect(stagnationCount([S1, S2, S3, S4, S5, S6], dismissed)).toBe(1);
  });
  it("uses capped reps in reps-only mode, without star", () => {
    const body1 = log(1, 0, [5, 3, 2], { weight_kg: 0 });
    const body2 = log(2, 0, [6, 4, 2], { weight_kg: 0 });
    expect(cappedLoadKg(body1)).toBe(0);
    expect(classifyLogs([body1, body2], settings).map(x => x.status)).toEqual(["baseline", "progress"]);
    expect(compareResult(body2, body1, false).kind).toBe("trend");
  });
});

describe("units, warmups, and rotation", () => {
  it("shows entered units exactly and rounds conversions to half units", () => {
    expect(displayValue(45, "lb", "lb")).toBe(45);
    expect(displayValue(20, "kg", "lb")).toBe(44);
  });
  const scheme: WarmupSchemeEntry[] = [{ pct: 0.5, reps: 15 }, { pct: 0.75, reps: 10 }, { pct: 0.9, reps: 5 }];
  it("rounds warmups DOWN to the nearest whole kg", () => {
    // barbell: base 20, per side on, entry 40 (real 100) → 50/75/90 real → 15/27.5→27/35 per side
    const bar = calculateWarmups({ workingEntry: 40, workingUnit: "kg", baseWeight: 20, baseWeightUnit: "kg", perSide: true, scheme });
    expect(bar.map(x => x.entry)).toEqual([15, 27, 35]);
    // dumbbell 30 (real 30) → 15/22.5/27 → floor 15/22/27
    const db = calculateWarmups({ workingEntry: 30, workingUnit: "kg", baseWeight: null, baseWeightUnit: null, perSide: false, scheme });
    expect(db.map(x => x.entry)).toEqual([15, 22, 27]);
    // light exercise: lateral raise 8 kg → 4/6/7 (never rounded to 5)
    const light = calculateWarmups({ workingEntry: 8, workingUnit: "kg", baseWeight: null, baseWeightUnit: null, perSide: false, scheme });
    expect(light.map(x => x.entry)).toEqual([4, 6, 7]);
  });
  it("shows base only, reps only, and unset-weight warmups", () => {
    const body = calculateWarmups({ workingEntry: 10, workingUnit: "kg", baseWeight: 80, baseWeightUnit: "kg", perSide: false, scheme });
    // 50%/75% of the 90 kg bodyweight+entry fall below the 80 kg base → Base only;
    // 90% = 81 → entry (81-80)/1 = 1 → "1 kg × 5"
    expect(body.map(x => x.label)).toEqual(["Base only × 15", "Base only × 10", "1 kg × 5"]);
    const unset = calculateWarmups({ workingEntry: null, workingUnit: "kg", baseWeight: null, baseWeightUnit: null, perSide: false, scheme });
    expect(unset.every(x => x.label.includes("set weight first"))).toBe(true);
    const reps = calculateWarmups({ workingEntry: 0, workingUnit: "kg", baseWeight: null, baseWeightUnit: null, perSide: false, scheme });
    expect(reps.map(x => x.label)).toEqual(["15 reps", "10 reps", "5 reps"]);
  });
  it("orders workouts by longest-since-done (never-done first)", () => {
    const workouts = [
      { id: "1", position: 1, lastDoneAt: "2026-09-20" },
      { id: "2", position: 2, lastDoneAt: null },
      { id: "3", position: 3, lastDoneAt: "2026-09-28" },
    ];
    // never-done on top, then oldest finished, most recent last
    expect(orderWorkoutsByRecency(workouts).map(x => x.id)).toEqual(["2", "1", "3"]);
    expect(orderWorkoutsByRecency([{ id: "a", position: 2, lastDoneAt: null }, { id: "b", position: 1, lastDoneAt: null }]).map(x => x.id)).toEqual(["b", "a"]);
  });
});
