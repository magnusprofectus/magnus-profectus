import type { MuscleGroup } from "../domain/types";
import { exerciseLibrary } from "./library";

export const TEMPLATE_DB_BENCH_ENABLED = false;
export interface TemplateExercise { key: string; warmup_mode?: "auto" | "on" | "off" }
export interface TemplateWorkout { name: string; exercises: TemplateExercise[] }
export interface ProgramTemplate { key: string; name: string; workouts: TemplateWorkout[] }
export const programTemplates: ProgramTemplate[] = [
  { key: "gym-2-split", name: "Gym 2-Split", workouts: [
    { name: "Workout A", exercises: ["leg-press", "hack-squat", "romanian-deadlift", "seated-leg-curl", "bench-press", "incline-dumbbell-press", "ez-bar-curl", "cable-curl"].map(key => ({ key })) },
    { name: "Workout B", exercises: ["lat-pulldown", "one-arm-dumbbell-row", "shoulder-press", "machine-shoulder-press", "skull-crusher", "triceps-pushdown", "standing-calf-raise", "seated-calf-raise"].map(key => ({ key })) },
  ] },
];
export function muscleGroupName(group: MuscleGroup): string {
  return ({ chest: "Chest", back: "Back", shoulders: "Shoulders", traps: "Traps", biceps: "Biceps", triceps: "Triceps", forearms: "Forearms", quads: "Quads", hamstrings_glutes: "Hamstrings & glutes", calves: "Calves", abs: "Abs" })[group];
}
export function libraryItem(key: string) { return exerciseLibrary.find(item => item.key === key); }
