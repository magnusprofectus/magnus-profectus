// Next-session weight direction (SPEC §6.7, user-revised 2026-09):
// the app recommends a *direction*, decrease / keep same and beat reps / increase —
// never a specific incremented weight. Weight choice stays with the user.
import type { DomainLog, ExerciseSettings } from "./types";
import { isEligible, orderedLogs } from "./progression";
import { totalReps } from "./load";

export type WeightDirection = "no_history" | "decrease" | "keep_same" | "increase";

export interface WeightRecommendation {
  direction: WeightDirection;
  message: string;
}

export function recommendWeight(logs: DomainLog[], _settings?: ExerciseSettings): WeightRecommendation {
  const latest = orderedLogs(logs).filter(isEligible).at(-1);
  if (!latest) return { direction: "no_history", message: "Pick a weight you can lift for about 7 good reps." };
  const reps = totalReps(latest);
  if (reps >= latest.targets_snapshot.total_max) {
    return { direction: "increase", message: "You hit the top of the range. Go heavier." };
  }
  if (reps < latest.targets_snapshot.total_min || (latest.miniset_reps[0] ?? 0) < (latest.targets_snapshot.miniset_targets[0]?.[0] ?? 0)) {
    return { direction: "decrease", message: "Below target. Go lighter." };
  }
  if (latest.rating !== null && latest.rating <= 1.5) {
    return { direction: "increase", message: "Felt easy. Try heavier." };
  }
  return { direction: "keep_same", message: "Right weight. Keep it and beat your reps." };
}
