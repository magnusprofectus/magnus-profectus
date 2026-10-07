// Warm-up suggestions (SPEC §6.8). All weights are in the user's entry convention.
//
// Rounding (user-revised 2026-09): suggestions round DOWN to the nearest whole
// kg/lb of the calculated amount, never up. Rounding to plate increments (e.g.
// 5 kg) distorts light exercises like lateral raises, where 5 vs 7.5 kg is a
// huge relative jump. The user picks the nearest available weight for the
// exercise; the guide and an inline note mention this.
import type { Unit, WarmupSchemeEntry } from "./types";
import { convert } from "./units";

export interface WarmupRow { pct: number; reps: number; entry: number | null; label: string }

/** Round DOWN to the nearest whole unit (kg/lb). */
export function roundDownToUnit(value: number): number {
  return Math.floor(value + 1e-9);
}

export function calculateWarmups(args: {
  workingEntry: number | null;
  workingUnit: Unit;
  baseWeight: number | null;
  baseWeightUnit: Unit | null;
  perSide: boolean;
  scheme: WarmupSchemeEntry[];
}): WarmupRow[] {
  const { workingEntry, workingUnit, perSide, scheme } = args;
  const base = args.baseWeight === null ? 0 : convert(args.baseWeight, args.baseWeightUnit ?? workingUnit, workingUnit);
  const f = perSide ? 2 : 1;
  if (workingEntry === null) return scheme.map(x => ({ pct: x.pct, reps: x.reps, entry: null, label: `× ${x.reps} (set weight first)` }));
  const workingReal = base + workingEntry * f;
  if (workingReal === 0) return scheme.map(x => ({ pct: x.pct, reps: x.reps, entry: 0, label: `${x.reps} reps` }));
  return scheme.map(({ pct, reps }) => {
    const exact = (pct * workingReal - base) / f;
    // below the base weight (e.g. light % of a heavy bar) → base only
    const entry = exact <= 0 ? 0 : roundDownToUnit(exact);
    return { pct, reps, entry, label: entry > 0 ? `${entry} ${workingUnit}${perSide ? " per side" : ""} × ${reps}` : `Base only × ${reps}` };
  });
}
