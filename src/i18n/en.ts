import { APP_NAME, PROTOCOL_NAME } from "../config/app";

export const en = {
  app: { name: APP_NAME, shortName: "Profectus" },
  guide: { title: `The ${PROTOCOL_NAME} Guide` },
  firstTime: "First time with this exercise: pick a weight you can lift for about 7 good reps.",
  weightInfo: "Use the same weight for all mini-sets. If it feels off, change it next session. We'll suggest how.",
  warmupConfirm: "Warm-up sets done?",
  lastChance: "No progress last time. Beat your recent best today to keep this exercise.",
  switchRecommended: "Two sessions without progress. This exercise has done its job. Time to switch.",
  baseline: "Fresh start: this is your starting point.",
  aboveRange: (max: number) => `Above target: reps past ${max} don't count. Go heavier next time.`,
  belowRange: "Below target: go lighter next time.",
  disclaimer: "This app provides general training information, not medical advice. Consult a doctor before starting a demanding program, especially with an injury or health condition. Training to failure carries risk; train at your own responsibility.",
} as const;
