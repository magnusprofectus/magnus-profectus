import type { MuscleGroup } from "../domain/types";
import { exerciseLibrary } from "./library";

export const TEMPLATE_DB_BENCH_ENABLED = false;
export interface TemplateExercise { key: string; warmup_mode?: "auto" | "on" | "off" }
export interface TemplateWorkout { name: string; exercises: TemplateExercise[] }
export interface ProgramTemplate { key: string; name: string; workouts: TemplateWorkout[] }
export const programTemplates: ProgramTemplate[] = [
  { key: "gym-2-split", name: "Default Program", workouts: [
    { name: "Workout A", exercises: ["flat-dumbbell-press", "leg-press", "dumbbell-curl", "incline-dumbbell-press", "standing-calf-raise", "hammer-curl"].map(key => ({ key })) },
    { name: "Workout B", exercises: ["tripod-dumbbell-row", "close-grip-dumbbell-press", "shoulder-press", "lat-pulldown", "dumbbell-face-pull", "skull-crusher"].map(key => ({ key })) },
  ] },
];
export function muscleGroupName(group: MuscleGroup): string {
  return ({ chest: "Chest", back: "Back", shoulders: "Shoulders", traps: "Traps", biceps: "Biceps", triceps: "Triceps", forearms: "Forearms", quads: "Quads", hamstrings_glutes: "Hamstrings & glutes", calves: "Calves", abs: "Abs" })[group];
}
export function libraryItem(key: string) { return exerciseLibrary.find(item => item.key === key); }
