// Workout ordering on the Train screen (user-revised 2026-09):
// default view = workouts ordered by how long since they were last done —
// longest-since-done on top ("up next"), most recently done at the bottom.
// Never-done workouts sort first (newest position order as tiebreak).
// Inspection must not imply activation: viewing a workout ≠ starting a session;
// starting a session is an explicit button.
export interface WorkoutWithRecency { id: string; position: number; lastDoneAt: string | null }

export function orderWorkoutsByRecency<T extends WorkoutWithRecency>(workouts: T[]): T[] {
  return [...workouts].sort((a, b) => {
    if (a.lastDoneAt === null && b.lastDoneAt === null) return a.position - b.position;
    if (a.lastDoneAt === null) return -1;
    if (b.lastDoneAt === null) return 1;
    return a.lastDoneAt.localeCompare(b.lastDoneAt); // oldest finished first
  });
}