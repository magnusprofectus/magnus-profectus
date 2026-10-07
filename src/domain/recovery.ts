// Recovery-modelled rep targets (research-based, SPEC §7.8 exercise editor).
//
// Physiology: between mini-sets the phosphagen system (ATP-PCr) recovers
// exponentially — ~50% resynthesis at 30 s, ~85% at 60 s, ~93% at 90 s,
// ~97% at 180 s (Bogdanis et al. 1995; fast-component half-time ~21-22 s,
// Harris et al. 1976). Rep performance does not fall proportionally to PCr,
// because anaerobic glycolysis keeps contributing: retention per rest is
// modelled as 0.5 + 0.5 × recoveryFraction. At the default 27 s that gives
// ~0.74 retention per mini-set → 6 → 4.4 → 3.3 reps, matching the
// methodology's calibrated 5-7 / 3-5 / 2-4 scheme.

/** Bogdanis-interpolated recovery curve points: [rest seconds, fraction recovered]. */
const RECOVERY_CURVE: Array<[number, number]> = [
  [0, 0], [10, 0.28], [20, 0.4], [30, 0.5], [40, 0.58], [60, 0.85],
  [90, 0.93], [120, 0.95], [180, 0.97], [300, 0.99], [480, 1],
];

/** Piecewise-linear, monotonic recovery fraction for a rest period in seconds. */
export function recoveryFraction(restSeconds: number): number {
  if (restSeconds <= 0) return 0;
  const t = Math.min(restSeconds, RECOVERY_CURVE[RECOVERY_CURVE.length - 1][0]);
  for (let i = 1; i < RECOVERY_CURVE.length; i++) {
    const [t0, r0] = RECOVERY_CURVE[i - 1];
    const [t1, r1] = RECOVERY_CURVE[i];
    if (t <= t1) return r0 + (t - t0) * (r1 - r0) / (t1 - t0);
  }
  return 1;
}

/**
 * Fraction of set-1 rep capacity retained for the mini-set after this rest.
 * 0.5 floor = glycolytic contribution that persists regardless of PCr recovery.
 */
export function retention(restSeconds: number): number {
  return 0.5 + 0.5 * recoveryFraction(restSeconds);
}

/** Predicted reps for mini-set k (0-based) after k rests of restSeconds. */
export function predictedReps(set1Target: number, restSeconds: number, miniSetIndex: number): number {
  const retained = Math.pow(retention(restSeconds), Math.max(0, miniSetIndex));
  return Math.max(1, Math.round(set1Target * retained));
}

/**
 * Derive descending per-set rep ranges for N mini-sets from rest + set-1 target.
 * Calibrated: 27 s rest + set-1 mid 6 → 4/3/3 mids ≈ the standard 5-7 / 3-5 / 2-4.
 */
export function deriveTargets(restSeconds: number, set1Target: number, miniSetCount: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let k = 0; k < miniSetCount; k++) {
    const mid = predictedReps(set1Target, restSeconds, k);
    if (k === 0) ranges.push([Math.max(1, mid - 1), Math.min(set1Target + 1, mid + 2)]);
    else ranges.push([Math.max(1, mid - 1), mid + 1]);
  }
  return ranges;
}

/**
 * Suggested mini-set count: how many sets until predicted reps fall below ~2.
 * Always 1-5 (SPEC §7.8). Calibrated: 27 s + set-1 mid 6 → 3.
 */
export function suggestMiniSetCount(restSeconds: number, set1Target: number): number {
  let count = 1;
  for (let k = 1; k < 5; k++) {
    // include the set only while it still yields at least ~2-3 productive reps
    if (predictedReps(set1Target, restSeconds, k) >= 3) count = k + 1;
    else break;
  }
  return Math.min(5, count);
}
