import type { MuscleGroup } from "../domain/types";
import { exerciseLibrary } from "./library";

export const TEMPLATE_DB_BENCH_ENABLED = false;
export interface TemplateCustomExercise { name: string; muscle_group: string; equipment: string[]; unilateral?: boolean }
export interface TemplateExercise { key?: string; custom?: TemplateCustomExercise; warmup_mode?: "auto" | "on" | "off" }
export interface TemplateWorkout { name: string; exercises: TemplateExercise[] }
export interface ProgramTemplate { key: string; name: string; workouts: TemplateWorkout[] }
export const programTemplates: ProgramTemplate[] = [
  { key: "gym-2-split", name: "Default Program", workouts: [
    { name: "Workout A", exercises: ["flat-dumbbell-press", "leg-press", "dumbbell-curl", "incline-dumbbell-press", "standing-calf-raise", "hammer-curl"].map(key => ({ key })) },
    { name: "Workout B", exercises: ["tripod-dumbbell-row", "close-grip-dumbbell-press", "shoulder-press", "lat-pulldown", "dumbbell-face-pull", "skull-crusher"].map(key => ({ key })) },
  ] },
  { key: "founders-dumbbell", name: "Founders Dumbbell Only Program", workouts: [
    { name: "Chest, legs, biceps", exercises: [{ key: "flat-dumbbell-press" }, { custom: { name: "Dumbbell Squat", muscle_group: "quads", equipment: ["dumbbell"] } }, { key: "dumbbell-curl" }, { key: "incline-dumbbell-press" }, { custom: { name: "Seated Hammer Curl", muscle_group: "biceps", equipment: ["dumbbell"] } }] },
    { name: "Back, triceps, shoulders", exercises: [{ custom: { name: "Tripod Row", muscle_group: "back", equipment: ["dumbbell"], unilateral: true } }, { custom: { name: "Close Grip Triceps Press", muscle_group: "triceps", equipment: ["dumbbell"] } }, { key: "shoulder-press" }, { custom: { name: "Lat Pullover", muscle_group: "back", equipment: ["dumbbell"] } }, { custom: { name: "Facepull", muscle_group: "shoulders", equipment: ["dumbbell"] } }, { custom: { name: "Skull Crusher", muscle_group: "triceps", equipment: ["dumbbell"] } }] },
  ] },
];
export function muscleGroupName(group: MuscleGroup): string {
  return ({ chest: "Chest", back: "Back", shoulders: "Shoulders", traps: "Traps", biceps: "Biceps", triceps: "Triceps", forearms: "Forearms", quads: "Quads", hamstrings_glutes: "Hamstrings & glutes", calves: "Calves", abs: "Abs" })[group];
}
export function libraryItem(key: string) { return exerciseLibrary.find(item => item.key === key); }
