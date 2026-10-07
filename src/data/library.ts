import type { Equipment, MuscleGroup } from "../domain/types";

export interface LibraryItem { key: string; name: string; muscle_group: MuscleGroup; equipment: Equipment[]; safety_flag?: boolean; unilateral?: boolean }
const item = (key: string, name: string, muscle_group: MuscleGroup, equipment: Equipment[], extras: Partial<LibraryItem> = {}): LibraryItem => ({ key, name, muscle_group, equipment, ...extras });

// Built-in exercise library (SPEC §10.2). Gym-equipment focus; ~70 movements
// across all 11 muscle groups. key is stable, never rename a key, only the label.
export const exerciseLibrary: LibraryItem[] = [
  // quads (8)
  item("leg-press", "Leg Press", "quads", ["machine"]), item("hack-squat", "Hack Squat", "quads", ["machine"]), item("back-squat", "Barbell Back Squat", "quads", ["barbell"], { safety_flag: true }), item("leg-extension", "Leg Extension", "quads", ["machine"]),
  item("front-squat", "Front Squat", "quads", ["barbell"], { safety_flag: true }), item("smith-squat", "Smith Machine Squat", "quads", ["machine"]), item("bulgarian-split-squat", "Bulgarian Split Squat", "quads", ["dumbbell"], { unilateral: true }), item("goblet-squat", "Goblet Squat", "quads", ["dumbbell"]),
  // hamstrings_glutes (8)
  item("romanian-deadlift", "Romanian Deadlift", "hamstrings_glutes", ["barbell"], { safety_flag: true }), item("seated-leg-curl", "Seated Leg Curl", "hamstrings_glutes", ["machine"]), item("lying-leg-curl", "Lying Leg Curl", "hamstrings_glutes", ["machine"]), item("hip-thrust", "Hip Thrust", "hamstrings_glutes", ["barbell"], { safety_flag: true }),
  item("stiff-leg-deadlift", "Stiff-Leg Deadlift", "hamstrings_glutes", ["barbell"], { safety_flag: true }), item("glute-extension", "Glute Kickback Machine", "hamstrings_glutes", ["machine"], { unilateral: true }), item("good-morning", "Good Morning", "hamstrings_glutes", ["barbell"], { safety_flag: true }), item("cable-pull-through", "Cable Pull-Through", "hamstrings_glutes", ["cable"]),
  // chest (9)
  item("bench-press", "Barbell Bench Press", "chest", ["barbell"], { safety_flag: true }), item("incline-dumbbell-press", "Incline Dumbbell Press", "chest", ["dumbbell"]), item("chest-press", "Machine Chest Press", "chest", ["machine"]), item("pec-deck", "Pec Deck", "chest", ["machine"]),
  item("incline-bench-press", "Incline Barbell Bench Press", "chest", ["barbell"], { safety_flag: true }), item("flat-dumbbell-press", "Flat Dumbbell Bench Press", "chest", ["dumbbell"]), item("cable-fly", "Cable Fly", "chest", ["cable"]), item("dumbbell-fly", "Dumbbell Fly", "chest", ["dumbbell"]), item("dip", "Chest Dip", "chest", ["bodyweight"]),
  // back (10)
  item("lat-pulldown", "Lat Pulldown", "back", ["machine"]), item("one-arm-dumbbell-row", "One-Arm Dumbbell Row", "back", ["dumbbell"], { unilateral: true }), item("seated-cable-row", "Seated Cable Row", "back", ["cable"]), item("machine-row", "Machine Row", "back", ["machine"]),
  item("barbell-row", "Barbell Row", "back", ["barbell"]), item("chest-supported-row", "Chest-Supported Row", "back", ["machine"]), item("t-bar-row", "T-Bar Row", "back", ["machine"]), item("straight-arm-pulldown", "Straight-Arm Pulldown", "back", ["cable"]),
  item("pull-up", "Pull-Up", "back", ["bodyweight"]), item("shrug", "Barbell Shrug", "traps", ["barbell"]),
  // traps (3)
  item("dumbbell-shrug", "Dumbbell Shrug", "traps", ["dumbbell"]), item("cable-shrug", "Cable Shrug", "traps", ["cable"]), item("machine-shrug", "Machine Shrug", "traps", ["machine"]),
  // shoulders (8)
  item("shoulder-press", "Seated Dumbbell Shoulder Press", "shoulders", ["dumbbell"]), item("machine-shoulder-press", "Machine Shoulder Press", "shoulders", ["machine"]), item("lateral-raise", "Dumbbell Lateral Raise", "shoulders", ["dumbbell"]),
  item("cable-lateral-raise", "Cable Lateral Raise", "shoulders", ["cable"], { unilateral: true }), item("machine-lateral-raise", "Machine Lateral Raise", "shoulders", ["machine"]), item("rear-delt-fly", "Rear Delt Fly", "shoulders", ["dumbbell"]), item("reverse-pec-deck", "Reverse Pec Deck", "shoulders", ["machine"]), item("barbell-front-raise", "Barbell Front Raise", "shoulders", ["barbell"]),
  // biceps (6)
  item("ez-bar-curl", "EZ-Bar Curl", "biceps", ["barbell"]), item("cable-curl", "Cable Curl", "biceps", ["cable"]), item("dumbbell-curl", "Dumbbell Curl", "biceps", ["dumbbell"]),
  item("incline-dumbbell-curl", "Incline Dumbbell Curl", "biceps", ["dumbbell"]), item("preacher-curl", "Preacher Curl", "biceps", ["machine"]), item("hammer-curl", "Hammer Curl", "biceps", ["dumbbell"]),
  // triceps (6)
  item("triceps-pushdown", "Cable Triceps Pushdown", "triceps", ["cable"]), item("skull-crusher", "EZ-Bar Skull Crusher", "triceps", ["barbell"], { safety_flag: true }), item("overhead-cable-extension", "Overhead Cable Extension", "triceps", ["cable"]),
  item("machine-dip", "Machine Dip", "triceps", ["machine"]), item("dumbbell-overhead-extension", "Dumbbell Overhead Extension", "triceps", ["dumbbell"]), item("close-grip-bench", "Close-Grip Bench Press", "triceps", ["barbell"], { safety_flag: true }),
  // forearms (3)
  item("wrist-curl", "Wrist Curl", "forearms", ["barbell"]), item("reverse-curl", "Reverse EZ-Bar Curl", "forearms", ["barbell"]), item("farmers-hold", "Farmer's Hold", "forearms", ["dumbbell"]),
  // calves (4)
  item("standing-calf-raise", "Standing Calf Raise", "calves", ["machine"]), item("seated-calf-raise", "Seated Calf Raise", "calves", ["machine"]), item("leg-press-calf-raise", "Leg Press Calf Raise", "calves", ["machine"]), item("dumbbell-calf-raise", "Dumbbell Calf Raise", "calves", ["dumbbell"], { unilateral: true }),
  // abs (6)
  item("cable-crunch", "Cable Crunch", "abs", ["cable"]), item("machine-crunch", "Machine Crunch", "abs", ["machine"]), item("hanging-leg-raise", "Hanging Leg Raise", "abs", ["bodyweight"]),
  item("ab-wheel", "Ab Wheel Rollout", "abs", ["other"]), item("dumbbell-side-bend", "Dumbbell Side Bend", "abs", ["dumbbell"], { unilateral: true }), item("weighted-plank", "Weighted Plank", "abs", ["other"]),
];
export const equipmentIncrement: Record<Equipment, { kg: number; lb: number }> = {
  barbell: { kg: 2.5, lb: 5 }, dumbbell: { kg: 2, lb: 5 }, machine: { kg: 5, lb: 10 }, cable: { kg: 2.5, lb: 5 }, bodyweight: { kg: 2.5, lb: 5 }, bench: { kg: 2.5, lb: 5 }, other: { kg: 2.5, lb: 5 },
};