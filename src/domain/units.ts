// Units (SPEC §6.1). Pure functions.
import { LB_PER_KG, type Unit } from "./types";

export function kgToLb(kg: number): number {
  return kg / LB_PER_KG;
}

export function lbToKg(lb: number): number {
  return lb * LB_PER_KG;
}

/** Convert a value between units (identity when same). */
export function convert(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  return to === "lb" ? kgToLb(value) : lbToKg(value);
}

export function roundToHalf(x: number): number {
  return Math.round(x * 2) / 2;
}

/**
 * Display value for a converted weight (SPEC §6.1): if the display unit equals the
 * entered unit show the entered value exactly; otherwise convert and round to 0.5.
 */
export function displayValue(
  entered: number,
  enteredUnit: Unit,
  displayUnit: Unit,
): number {
  if (enteredUnit === displayUnit) return entered;
  return roundToHalf(convert(entered, enteredUnit, displayUnit));
}

/** Max 1 decimal, strip trailing `.0`. */
export function formatNumber(x: number): string {
  const rounded = Math.round(x * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** Totals (load) display as integers (SPEC §6.1). */
export function formatTotalLoad(x: number): string {
  return String(Math.round(x));
}
