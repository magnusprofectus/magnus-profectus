// Timer engine (SPEC §8): timestamp-based, persisted, Web Audio cues,
// vibration + wake lock where supported. Never counts interval ticks.

export interface TimerState {
  endsAt: number | null; // epoch ms
  mode: "miniset" | "between" | null;
  startedAt: number | null;
}

const KEY = "rp-timer-state";
export function loadTimer(): TimerState {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return { endsAt: null, mode: null, startedAt: null }; }
}
export function storeTimer(state: TimerState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

let audioCtx: AudioContext | null = null;
let scheduled: OscillatorNode[] = [];
export function unlockAudio(): void {
  if (audioCtx) { void audioCtx.resume(); return; }
  try { audioCtx = new AudioContext(); } catch { audioCtx = null; }
}
function tone(at: number, freq: number, duration: number, volume: number): void {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  osc.type = "sine";
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.05);
  scheduled.push(osc);
}
/** Pre-schedule cues relative to now; robust to JS throttling (§8.1). */
export function scheduleCues(remainingMs: number, getReadySec: number, volume: number): void {
  if (!audioCtx) return;
  const base = audioCtx.currentTime + 0.05;
  if (getReadySec > 0 && remainingMs > getReadySec * 1000) tone(base + (remainingMs / 1000 - getReadySec), 880, 0.25, volume * 0.4);
  tone(base + remainingMs / 1000, 1318, 0.7, volume);
  tone(base + remainingMs / 1000 + 0.25, 1318, 0.5, volume);
}
export function stopScheduled(): void {
  for (const osc of scheduled) { try { osc.stop(); } catch { /* already stopped */ } }
  scheduled = [];
}

export function vibrate(ms: number): boolean {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) { navigator.vibrate(ms); return true; }
  return false;
}
export const vibrationSupported = typeof navigator !== "undefined" && "vibrate" in navigator;

export type WakeLockSentinelLike = { release: () => Promise<void> };
let wakeLock: WakeLockSentinelLike | null = null;
export async function acquireWakeLock(): Promise<void> {
  try { wakeLock = await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<WakeLockSentinelLike> } }).wakeLock?.request("screen") ?? null; } catch { wakeLock = null; }
}
export async function releaseWakeLock(): Promise<void> {
  try { await wakeLock?.release(); } finally { wakeLock = null; }
}
export function reacquireOnVisible(): void {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wakeLock === null) void acquireWakeLock();
  });
}

/** Start the rest-pause timer: persists endsAt and schedules audio cues. */
export async function startMinisetRest(restSeconds: number, getReadySec: number, volume: number, vibrationMs: number): Promise<TimerState> {
  unlockAudio();
  const startedAt = Date.now();
  const endsAt = startedAt + restSeconds * 1000;
  const state: TimerState = { endsAt, mode: "miniset", startedAt };
  storeTimer(state);
  scheduleCues(endsAt - startedAt, getReadySec, volume);
  void vibrate;
  void vibrationMs;
  return state;
}
export function stopTimer(): void {
  stopScheduled();
  storeTimer({ endsAt: null, mode: null, startedAt: null });
}
export function remainingMs(state: TimerState, now: number): number {
  return state.endsAt ? Math.max(0, state.endsAt - now) : 0;
}
