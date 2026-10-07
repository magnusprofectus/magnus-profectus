import { describe, expect, it } from "vitest";
import { recoveryFraction, retention, predictedReps, deriveTargets, suggestMiniSetCount } from "../recovery";

describe("recovery model (Bogdanis-interpolated)", () => {
  it("matches the recovery curve at reference points", () => {
    expect(Math.round(recoveryFraction(30) * 100)).toBe(50);
    expect(Math.round(recoveryFraction(60) * 100)).toBe(85);
    expect(Math.round(recoveryFraction(90) * 100)).toBe(93);
    expect(Math.round(recoveryFraction(180) * 100)).toBe(97);
  });
  it("27s retention reproduces the methodology's 6/4/3 drop-off", () => {
    expect(Math.round(retention(27) * 100)).toBe(74);
    expect([0, 1, 2].map(k => predictedReps(6, 27, k))).toEqual([6, 4, 3]);
  });
  it("derives the standard 5-7 / 3-5 / 2-4 at 27s with set-1 target 6", () => {
    expect(deriveTargets(27, 6, 3)).toEqual([[5, 7], [3, 5], [2, 4]]);
  });
  it("longer rest flattens the drop-off; shorter steepens it", () => {
    expect(predictedReps(6, 60, 2)).toBeGreaterThan(predictedReps(6, 27, 2));
    expect(predictedReps(6, 10, 2)).toBeLessThan(predictedReps(6, 27, 2));
  });
  it("suggests mini-set counts by rest length", () => {
    expect(suggestMiniSetCount(27, 6)).toBe(3);
    expect(suggestMiniSetCount(90, 6)).toBeGreaterThan(3);
  });
  it("never returns below 1 rep and clamps to 5 sets", () => {
    expect(predictedReps(6, 5, 4)).toBeGreaterThanOrEqual(1);
    expect(suggestMiniSetCount(300, 10)).toBeLessThanOrEqual(5);
  });
});
