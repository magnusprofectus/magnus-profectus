import { newId } from "./data/ids";
import brandMark from "./assets/brand-mark.png";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Exercise, type ExerciseLog, type WorkoutExercise } from "./data/db";
import { ensureSeeded } from "./data/seed";
import { activateProgram } from "./data/programs";
import { createWorkout } from "./data/programs";
import { finishSession, saveLog, startOrResumeSession, updateMinisetRep } from "./data/session";
import * as repo from "./data/repo";
import { exportFile, maybeAutosave, saveBackup } from "./data/backup";
import { convert, displayValue, formatNumber } from "./domain/units";
import { cappedLoadKg, cappedReps, totalReps } from "./domain/load";
import { calculateWarmups } from "./domain/warmup";
import { orderWorkoutsByRecency } from "./domain/rotation";
import { stagnationCount, classifyLogs } from "./domain/progression";
import { compareResult } from "./domain/status";
import { isRepsOnly } from "./domain/load";

type FinishSummaryData = {
  session: import("./data/db").Session;
  durationMin: number;
  workoutLoad: number;
  priorLoad: number | null;
  progressed: number;
  eligibleCount: number;
  rows: Array<{ log: ExerciseLog; name: string }>;
  isRepsOnly: boolean;
};
function isRepsOnlyLog(log: ExerciseLog): boolean {
  return isRepsOnly({ weight_kg: log.weight_kg ?? 0, base_weight_kg_snapshot: log.base_weight_kg_snapshot ?? 0, per_side_snapshot: log.per_side_snapshot });
}
import { recommendWeight } from "./domain/recommend";
import * as recovery from "./domain/recovery";
import { libraryItem, muscleGroupName } from "./data/templates";
import { equipmentIncrement, exerciseLibrary } from "./data/library";
import { APP_NAME, APP_VERSION, DONATION_URL, PROTOCOL_NAME } from "./config/app";
import { loadTimer, remainingMs, startMinisetRest, stopTimer, storeTimer, unlockAudio, acquireWakeLock, releaseWakeLock, reacquireOnVisible } from "./timer/engine";
import * as sync from "./data/sync";
import { articles, articleBySlug, teamPicks, recordClick, fetchPopular } from "./data/articles";
import "./App.css";

type Tab = "Train" | "Programs" | "History" | "Guide" | "Extra" | "Settings";
const tabs: Tab[] = ["Train", "Programs", "History", "Guide", "Extra", "Settings"];

type DomainLogView = ExerciseLog & { is_deload: boolean; is_illness: boolean };

/** Hash routing (user-requested 2026-10): browser back button returns to the
 * previous in-app page and F5 restores the exact view. State lives in location.hash:
 * #/tab/workoutId | #/tab/article/slug | #/tab/exerciseId (logger). */
type RouteState = { tab: Tab; workoutId: string | null; exerciseLogId: string | null; articleSlug: string | null; circuit?: boolean };
function routeToHash(r: RouteState): string {
  const parts = ["", r.tab];
  if (r.circuit) parts.push("circuit");
  else if (r.tab === "Extra" && r.articleSlug) parts.push("article", r.articleSlug);
  else if (r.tab === "Train" && r.exerciseLogId) parts.push("log", r.exerciseLogId);
  else if (r.tab === "Train" && r.workoutId) parts.push(r.workoutId);
  return "#/" + parts.slice(1).filter(Boolean).join("/");
}
function hashToRoute(): RouteState {
  const seg = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const tab = (tabs as string[]).includes(seg[0] ?? "") ? (seg[0] as Tab) : "Train";
  if (seg[0] === "Extra" && seg[1] === "article") return { tab, workoutId: null, exerciseLogId: null, articleSlug: seg[2] ?? null };
  if (seg[0] === "Train" && seg[1] === "log") return { tab: "Train", workoutId: null, exerciseLogId: seg[2] ?? null, articleSlug: null };
  if (seg[0] === "Train" && seg[1] === "circuit") return { tab: "Train", workoutId: null, exerciseLogId: null, articleSlug: null, circuit: true };
  if (tab === "Train") return { tab, workoutId: seg[1] ?? null, exerciseLogId: null, articleSlug: null };
  return { tab, workoutId: null, exerciseLogId: null, articleSlug: null };
}

function App() {
  const [tab, setTab] = useState<Tab>(() => hashToRoute().tab);
  const [selected, setSelected] = useState<string | null>(() => hashToRoute().workoutId);
  const [articleSlug, setArticleSlug] = useState<string | null>(() => hashToRoute().articleSlug);
  const [routeLogId, setRouteLogId] = useState<string | null>(() => hashToRoute().exerciseLogId);
  const [circuitOpen, setCircuitOpen] = useState<boolean>(() => hashToRoute().circuit ?? false);
  const [circuitInfo, setCircuitInfo] = useState(false);
  // pushState on every view change so Back walks the visited pages
  const lastHash = location.hash;
  const applyHash = () => {
    const r = hashToRoute();
    setTab(r.tab); setSelected(r.workoutId); setArticleSlug(r.articleSlug); setRouteLogId(r.exerciseLogId); setCircuitOpen(r.circuit ?? false);
  };
  useEffect(() => {
    const want = routeToHash({ tab, workoutId: selected, exerciseLogId: routeLogId, articleSlug, circuit: circuitOpen });
    if (location.hash !== want) { history.pushState(null, "", want); }
    const onPop = () => applyHash();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  });
  void lastHash;
  const [showAdd, setShowAdd] = useState(false);
  const [showProgramForm, setShowProgramForm] = useState(false);
  useEffect(() => {
    const open = () => setShowProgramForm(true);
    const train = (e: Event) => { setSelected((e as CustomEvent).detail as string); setTab("Train"); };
    document.addEventListener("open-program-form", open);
    window.addEventListener("train-split", train);
    return () => { document.removeEventListener("open-program-form", open); window.removeEventListener("train-split", train); };
  }, []);
  const [programName, setProgramName] = useState("");
  const [splitName, setSplitName] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [timerEnd, setTimerEnd] = useState<number | null>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [busy, setBusy] = useState(true);
  const [removeConfirm, setRemoveConfirm] = useState<{ linkId: string; name: string } | null>(null);
  const programs = useLiveQuery(() => db.programs.filter(p => !p.deleted_at).sortBy("sort"));
  const settings = useLiveQuery(() => db.user_settings.get("local"));
  const program = programs?.find(p => p.id === settings?.active_program_id) ?? programs?.[0];
  const lockedDefault = program?.is_default === 1 && !program?.unmaintained; // curated program: read-only structure
  const workouts = useLiveQuery(async () => program ? db.workouts.where("program_id").equals(program.id).filter(w => !w.deleted_at).sortBy("position") : [], [program?.id]);
  const lastFinished = useLiveQuery(async () => program ? db.sessions.where("program_id").equals(program.id).filter(s => s.status === "finished" && !s.deleted_at).sortBy("finished_at") : [], [program?.id]);
  // per-workout recency: last finished_at per workout_id (Train-screen ordering, user-revised)
  const workoutLastDone = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of lastFinished ?? []) if (s.finished_at) map.set(s.workout_id, s.finished_at);
    return map;
  }, [lastFinished]);
  const orderedWorkouts = useMemo(() => orderWorkoutsByRecency((workouts ?? []).map(w => ({ ...w, lastDoneAt: workoutLastDone.get(w.id) ?? null }))), [workouts, workoutLastDone]);
  useEffect(() => { if (!activeLogId && orderedWorkouts.length && !orderedWorkouts.some(w => w.id === selected)) setSelected(orderedWorkouts[0].id); }, [orderedWorkouts, selected, activeLogId]);
  const allWorkouts = useLiveQuery(() => db.workouts.toArray());
  const allLinks = useLiveQuery(() => db.workout_exercises.toArray());
  const [unit, setUnit] = useState<"kg" | "lb">("kg");
  useEffect(() => { if (settings?.units) setUnit(settings.units); }, [settings?.units]);
  async function setActiveProgram(id: string) { await activateProgram(id); setSelected(null); setTab("Train"); }
  async function createNewProgram(name: string, workoutName: string) {
    const program = await repo.createBlankProgram(name, workoutName);
    await activateProgram(program.id);
    const splits = await db.workouts.where("program_id").equals(program.id).sortBy("position");
    setSelected(splits[0]?.id ?? null);
    setProgramName(""); setSplitName(""); setShowProgramForm(false); setTab("Programs");
  }
  async function addSplit() { if (!program) return; await createWorkout(program.id, splitName); setSplitName(""); }
  async function setUnits(next: "kg" | "lb") {
    setUnit(next);
    await repo.patchSettings({ units: next });
  }
  const activeWorkout = useLiveQuery(async () => selected ? db.workouts.get(selected) : undefined, [selected]);
  const workoutRows = useLiveQuery(async () => selected ? db.workout_exercises.where("workout_id").equals(selected).filter(x => !x.replaced_at && !x.deleted_at).sortBy("position") : [], [selected]);
  const exercises = useLiveQuery(() => db.exercises.toArray());
  const liveSessions = useLiveQuery(() => db.sessions.toArray());
  const currentSession = useMemo(() => sessionId ? liveSessions?.find(s => s.id === sessionId) : liveSessions?.find(s => s.status === "in_progress" && !s.deleted_at), [liveSessions, sessionId]);
  const sessionLogs = useLiveQuery(async () => currentSession ? db.exercise_logs.where("session_id").equals(currentSession.id).filter(x => !x.deleted_at).sortBy("position") : [], [currentSession?.id]);
  const activeLog = sessionLogs?.find(row => row.id === activeLogId);
  const activeExercise = activeLog ? exercises?.find(ex => ex.id === activeLog.exercise_id) : undefined;
  const recentLogs = useLiveQuery(async () => activeExercise ? db.exercise_logs.where("exercise_id").equals(activeExercise.id).filter(x => !x.deleted_at).toArray() : [], [activeExercise?.id]);

  useEffect(() => { ensureSeeded().then(() => repo.autoFinishStale()).finally(() => setBusy(false)); }, []);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(id); }, []);
  useEffect(() => { if (timerEnd && timerEnd - now <= 0) setTimerEnd(null); }, [now, timerEnd]);
  useEffect(() => { if (sessionId) localStorage.setItem("rp-current-session", sessionId); }, [sessionId]);
  useEffect(() => { const saved = localStorage.getItem("rp-current-session"); if (saved && !sessionId) setSessionId(saved); }, [sessionId]);
  useEffect(() => { if (currentSession) void acquireWakeLock(); else void releaseWakeLock(); }, [currentSession]);
  useEffect(() => { reacquireOnVisible(); }, []);

  // restore persisted timer (survives reload, §8.1)
  useEffect(() => {
    const persisted = loadTimer();
    if (persisted.endsAt && persisted.endsAt > Date.now()) setTimerEnd(persisted.endsAt);
  }, []);
  useEffect(() => { if (timerEnd) storeTimer({ endsAt: timerEnd, mode: "miniset", startedAt: Date.now() }); }, [timerEnd]);

  const joined = useMemo(() => (workoutRows ?? []).flatMap(row => {
    const ex = exercises?.find(e => e.id === row.exercise_id);
    return ex ? [{ row, ex }] : [];
  }), [workoutRows, exercises]);

  // §7.3 warm-up rule (warmup_mode=auto): the first exercise of each muscle group
  // in the current order gets warm-ups; later same-group exercises don't.
  // Recomputed on reorder. on/off override. (§6.8: only applies when required.)
  const warmupRequired = useMemo(() => {
    const seen = new Set<string>();
    const map = new Map<string, boolean>();
    for (const { row, ex } of joined) {
      if (row.warmup_mode === "on") map.set(ex.id, true);
      else if (row.warmup_mode === "off") map.set(ex.id, false);
      else {
        const first = !seen.has(ex.muscle_group);
        seen.add(ex.muscle_group);
        map.set(ex.id, first);
      }
    }
    return map;
  }, [joined]);


  // per-exercise domain state for the session screen rows (§6.4-6.5, §7.3)
  const allLogs = useLiveQuery(() => db.exercise_logs.filter(x => !x.deleted_at).toArray());

  // Warm-up circuit (user-requested 2026-10): available once every warmup-checked
  // exercise of the workout has a target weight in this session (entered now or from
  // last completed session). Row order: warmup set 1 of each exercise, then set 2...
  const circuitData = useMemo(() => {
    if (!currentSession) return { available: false, reason: "no_session", rows: [] };
    const warm = joined.filter(({ ex }) => warmupRequired.get(ex.id) === true);
    if (warm.length === 0) return { available: false, reason: "no_warmup", rows: [] };
    const logs = allLogs ?? [];
    const rows: Array<{ name: string; ex: Exercise; log: ExerciseLog | null; warmups: ReturnType<typeof calculateWarmups> }> = [];
    let missing: string[] = [];
    for (const { ex } of warm) {
      const sessionLog = (sessionLogs ?? []).find(x => x.exercise_id === ex.id && x.status !== "skipped");
      const target = sessionLog?.weight_entered ?? logs.filter(x => x.exercise_id === ex.id && x.status === "completed" && !x.deleted_at).sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0]?.weight_entered ?? null;
      if (target === null) { missing.push(ex.name); continue; }
      const unit = sessionLog?.weight_unit ?? ex.increment_unit;
      const warmups = calculateWarmups({ workingEntry: target, workingUnit: unit, labelUnit: unit, baseWeight: ex.base_weight, baseWeightUnit: ex.base_weight_unit, perSide: ex.per_side, scheme: settings?.warmup_scheme ?? [{ pct: 0.5, reps: 15 }, { pct: 0.75, reps: 7 }, { pct: 0.9, reps: 3 }] });
      rows.push({ name: ex.name, ex, log: sessionLog ?? null, warmups });
    }
    if (missing.length > 0) return { available: false, reason: "missing_weights", missing, rows: [] };
    // interleave: warmup set 1 of each, then set 2...
    const maxSets = Math.max(...rows.map(r => r.warmups.length), 0);
    const flat: Array<{ name: string; label: string; setNo: number; pct: number }> = [];
    for (let s = 0; s < maxSets; s++) for (const r of rows) { const wu = r.warmups[s]; if (wu) flat.push({ name: r.name, label: wu.label, setNo: s + 1, pct: wu.pct }); }
    return { available: true, reason: "ok", rows: flat };
  }, [currentSession, joined, warmupRequired, sessionLogs, allLogs, settings?.warmup_scheme, unit]);
  const circuitUnavailableReason = circuitData.available ? "" : circuitData.reason === "no_session" ? "Start a session first, the circuit belongs to a running workout." : circuitData.reason === "no_warmup" ? "No exercise in this workout has warm-ups enabled (toggle WARM-UP per exercise)." : `Enter target weights for the warm-up exercises (${circuitData.missing?.join(", ") ?? ""}) in this session, or complete one full workout first, next time the weights are known and the circuit becomes available.`;
  const rowState = useMemo(() => {
    const logs = allLogs ?? [];
    const map = new Map<string, { stagnation: number; last: ExerciseLog | undefined; painFlag: boolean; todayStatus: string; spark: number[] }>();
    for (const { ex, row } of joined) {
      const exLogs = logs.filter(x => x.exercise_id === ex.id);
      // §7.5 mini: last 6 completed capped loads (kg) for the row sparkline
      const spark = exLogs.filter(x => x.status === "completed").sort((a, b) => (a.completed_at ?? "").localeCompare(b.completed_at ?? "")).slice(-6)
        .map(x => (x.base_weight_kg_snapshot ?? 0) + (x.weight_kg ?? 0) * (x.per_side_snapshot ? 2 : 1));
      const today = sessionLogs?.find(x => x.exercise_id === ex.id && row.workout_id === selected);
      map.set(ex.id, {
        stagnation: stagnationCount(exLogs as unknown as import("./domain/types").DomainLog[], { baseline_reset_at: ex.baseline_reset_at, stagnation_dismissed_at: ex.stagnation_dismissed_at }, settings?.progression_window ?? 3, settings?.gap_reset_weeks ?? 4),
        last: exLogs.filter(x => x.status === "completed").sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0],
        painFlag: exLogs.filter(x => x.status === "completed").sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0]?.pain ?? false,
        todayStatus: today?.status ?? "not_started",
        spark,
      });
    }
    return map;
  }, [joined, allLogs, sessionLogs, selected, settings?.progression_window, settings?.gap_reset_weeks]);

  async function beginExercise(exerciseId: string) {
    if (!program || !activeWorkout || !exercises) return;
    unlockAudio();
    const session = await startOrResumeSession(program.id, activeWorkout, exercises);
    setSessionId(session.id);
    const rows = await db.exercise_logs.where("session_id").equals(session.id).filter(x => !x.deleted_at).sortBy("position");
    const log = rows.find(row => row.exercise_id === exerciseId);
    if (log) { setActiveLogId(log.id); return; }
    const ex = exercises.find(item => item.id === exerciseId);
    if (!ex) return;
    const nowIso = new Date().toISOString();
    const row: ExerciseLog = { id: newId(), user_id: "local", created_at: nowIso, updated_at: nowIso, deleted_at: null, _dirty: 1, session_id: session.id, exercise_id: ex.id, position: rows.length, status: "not_started", weight_entered: null, weight_unit: unit, weight_kg: null, base_weight_kg_snapshot: ex.base_weight ?? 0, per_side_snapshot: ex.per_side, targets_snapshot: { miniset_targets: ex.miniset_targets, total_min: ex.total_target_min, total_max: ex.total_target_max }, miniset_reps: Array(ex.miniset_count).fill(null), rating: null, pain: false, pain_note: "", warmup_confirmed: false, completed_at: null, notes: "" };
    await db.exercise_logs.put(row);
    setActiveLogId(row.id);
  }

  async function patchActiveLog(patch: Partial<ExerciseLog>) {
    if (!activeLog) return;
    let fields = patch;
    const entered = patch.weight_entered ?? activeLog.weight_entered;
    if (patch.weight_entered !== undefined && entered !== null) fields = { ...patch, weight_kg: convert(entered, activeLog.weight_unit, "kg") };
    const next = { ...activeLog, ...fields };
    const complete = next.weight_entered !== null && next.miniset_reps.length > 0 && next.miniset_reps.every(r => r !== null);
    fields = { ...fields, status: complete ? "completed" : "in_progress", completed_at: complete ? (activeLog.completed_at ?? new Date().toISOString()) : null };
    await saveLog(activeLog, fields);
  }
  const [betweenRestEndsAt, setBetweenRestEndsAt] = useState<number | null>(null);
  const [startFlags, setStartFlags] = useState<{ workoutId: string; deload: boolean; illness: boolean } | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [authState, setAuthState] = useState<"checking" | "anonymous" | "server">("checking");
  const [authUser, setAuthUser] = useState<string | null>(null);
  // Public v1 is offline-first: the auth screen is opt-in only (Settings), never shown on boot.
  const [skipAuthScreen, setSkipAuthScreen] = useState(true);
  const [serverAvailable, setServerAvailable] = useState(false);
  useEffect(() => { void sync.checkSession().then(({ user, serverUp }) => { setServerAvailable(serverUp); if (user) { setAuthUser(user.username); setAuthState("server"); void sync.pull(); } else setAuthState("anonymous"); }); }, []);
  // multi-device: pull server changes when returning to the tab
  useEffect(() => {
    if (authState !== "server") return;
    const onFocus = () => { void sync.pull(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [authState]);
  async function handleAuth(username: string, password: string, mode: "login" | "register") {
    if (mode === "register") await sync.register(username, password); else await sync.login(username, password);
    setAuthUser(username); setAuthState("server");
    if (mode === "register") { setTab("Guide"); }
  }
  async function handleLogout() {
    await sync.logout();
    setAuthUser(null); setAuthState("anonymous"); setSkipAuthScreen(true);
    window.location.reload();
  }
  async function cancelCurrentWorkout() {
    if (!currentSession) return;
    await repo.cancelSession(currentSession.id);
    setSessionId(null);
    setActiveLogId(null);
    localStorage.removeItem("rp-current-session");
    stopTimer(); setTimerEnd(null);
    setBetweenRestEndsAt(null);
    setCancelConfirm(false);
    void releaseWakeLock();
  }
  const [finishSummary, setFinishSummary] = useState<FinishSummaryData | null>(null);
  async function finishCurrentWorkout() {
    if (!currentSession || !exercises) return;
    // §7.7: build the summary BEFORE finishing so statuses are still "live"
    const logs = await db.exercise_logs.where("session_id").equals(currentSession.id).filter(x => !x.deleted_at).sortBy("position");
    const completedLogs = logs.filter(x => x.status === "completed");
    const workoutLoad = completedLogs.reduce((sum, log) => {
      if (isRepsOnlyLog(log)) return sum;
      return sum + cappedLoadKg({ ...log, weight_kg: log.weight_kg ?? 0 });
    }, 0);
    // §6.10: compare with previous finished session of the same workout
    const priorFinished = (liveSessions ?? []).filter(s => s.status === "finished" && !s.deleted_at && s.workout_id === currentSession.workout_id && s.id !== currentSession.id).sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))[0];
    let priorLoad: number | null = null;
    if (priorFinished) {
      const priorLogs = await db.exercise_logs.where("session_id").equals(priorFinished.id).filter(x => !x.deleted_at).toArray();
      priorLoad = priorLogs.filter(x => x.status === "completed").reduce((sum, log) => {
        if (isRepsOnlyLog(log)) return sum;
        return sum + cappedLoadKg({ ...log, weight_kg: log.weight_kg ?? 0 });
      }, 0);
    }
    // §6.10: X of Y progressed over eligible non-baseline completed logs
    let progressed = 0; const eligible: ExerciseLog[] = [];
    for (const log of completedLogs) {
      if (currentSession.is_deload || currentSession.is_illness) continue;
      const exLogs = (await db.exercise_logs.where("exercise_id").equals(log.exercise_id).filter(x => !x.deleted_at && x.status === "completed").toArray())
        .filter(x => x.id !== log.id && x.completed_at !== null && log.completed_at !== null && x.completed_at < log.completed_at)
        .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
      const ex = exercises.find(e => e.id === log.exercise_id);
      if (!ex) continue;
      const classified = classifyLogs(
        [...exLogs.slice(0, 6), log] as unknown as import("./domain/types").DomainLog[],
        { baseline_reset_at: ex.baseline_reset_at },
        settings?.progression_window ?? 3, settings?.gap_reset_weeks ?? 4,
      );
      const own = classified.find(c => c.log.id === log.id);
      eligible.push(log);
      if (own?.status === "progress" || own?.status === "progress_star") progressed++;
    }
    setFinishSummary({
      session: currentSession,
      durationMin: Math.max(1, Math.round((Date.now() - new Date(currentSession.started_at).getTime()) / 60000)),
      workoutLoad,
      priorLoad,
      progressed,
      eligibleCount: eligible.length,
      rows: logs.map(log => ({ log, name: exercises.find(e => e.id === log.exercise_id)?.name ?? "?" })),
      isRepsOnly: completedLogs.every(isRepsOnlyLog),
    });
    await finishSession(currentSession);
    void maybeAutosave();
    setSessionId(null);
    setActiveLogId(null);
    localStorage.removeItem("rp-current-session");
    stopTimer(); setTimerEnd(null);
    void releaseWakeLock();
  }
  async function skipActiveLog() {
    if (!activeLog) return;
    await saveLog(activeLog, { status: "skipped" });
    setActiveLogId(null);
  }
  /** A removed/swapped exercise leaves its pre-created not_started log behind in the
   * current session, a ghost row in history. Clean it up together with the link. */
  async function dropGhostLog(exerciseId: string) {
    if (!currentSession) return;
    const log = (sessionLogs ?? []).find(x => x.exercise_id === exerciseId && x.status === "not_started");
    if (log) await repo.softDelete(db.exercise_logs, log.id);
  }
  async function swapExercise(newKey: string) {
    if (!activeLog) return;
    const link = (allLinks ?? []).find(x => x.exercise_id === activeLog.exercise_id && x.workout_id === selected && !x.replaced_at);
    if (!link) return;
    await dropGhostLog(activeLog.exercise_id);
    await repo.replaceExerciseInWorkout(link, await ensureExercise(newKey));
    setActiveLogId(null);
  }
  async function ensureExercise(key: string): Promise<string> {
    const existing = await db.exercises.where("library_key").equals(key).first();
    if (existing) return existing.id;
    const item = libraryItem(key); if (!item) throw new Error("missing library item");
    // Technique reminder disabled (2026-10-07, user decision): appeared inconsistently,
    // sometimes twice for one exercise. The guide carries the technique content instead.
    const ex = await repo.createExercise({
      name: item.name, muscle_group: item.muscle_group, equipment: item.equipment, library_key: item.key, setup_notes: "",
      base_weight: null, base_weight_unit: null, per_side: false, unilateral: !!item.unilateral,
      increment: equipmentIncrement[item.equipment[0]].kg, increment_unit: unit, miniset_count: 3,
      miniset_targets: [[5, 7], [3, 5], [2, 4]], total_target_min: 12, total_target_max: 15,
      rest_seconds: 27, safety_flag: !!item.safety_flag, technique_confirmed: true,
    });
    return ex.id;
  }
  async function addExercise(key: string) {
    if (!selected) return;
    const exerciseId = await ensureExercise(key);
    const existingLink = await db.workout_exercises.where("workout_id").equals(selected).filter(x => x.exercise_id === exerciseId && !x.replaced_at).first();
    if (!existingLink) await repo.addExerciseToWorkout(selected, exerciseId);
    setShowAdd(false);
  }
  async function removeExercise(linkId: string) {
    const link = (allLinks ?? []).find(x => x.id === linkId);
    if (link && currentSession) await dropGhostLog(link.exercise_id);
    await repo.removeExerciseFromWorkout(linkId);
  }
  async function moveExercise(linkId: string, direction: -1 | 1) {
    const rows = (workoutRows ?? []).filter(x => !x.deleted_at);
    const ids = rows.map(x => x.id);
    const index = ids.indexOf(linkId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const reordered = [...ids];
    reordered[index] = ids[target];
    reordered[target] = ids[index];
    // renumber sequentially so duplicate/stale positions are repaired on every move
    await repo.renumberExercises(reordered);
  }

  if (busy) return <div className="boot">Starting {APP_NAME}…</div>;
  if (authState === "anonymous" && !skipAuthScreen) return <AuthScreen onSkip={() => setSkipAuthScreen(true)} onAuth={(u, p, m) => handleAuth(u, p, m)} />;
  return <div className="app-shell">
    <header className="topbar"><img className="brand-mark" src={brandMark} alt="Magnus Profectus mark" /><div><strong>{APP_NAME}</strong><small>{PROTOCOL_NAME} · Local mode</small></div><span className="sync-pill"><i /> {authUser ? `${authUser} · synced` : "Local data"}</span>{authUser && <button className="button-secondary" onClick={() => void handleLogout()}>Log out</button>}</header>
    <main className="main-content">
      {tab === "Train" && activeLog && activeExercise ? <ExerciseLogger
        exercise={activeExercise} log={activeLog}
        previous={recentLogs?.filter(x => x.status === "completed" && x.id !== activeLog.id && x.session_id !== activeLog.session_id).sort((a,b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0]}
        settings={settings} now={now} timerEnd={timerEnd}
        onStartTimer={async () => { const state = await startMinisetRest(activeExercise.rest_seconds, 5, 0.7, 400); setTimerEnd(state.endsAt); }}
        onStopTimer={() => { stopTimer(); setTimerEnd(null); }}
        onChange={patchActiveLog} onBack={() => setActiveLogId(null)}
        onSkip={() => void skipActiveLog()} onSwap={key => void swapExercise(key)} onKeep={() => void repo.keepExercise(activeExercise.id)}
        onDone={async () => { if (!activeLog) return; const filled = activeLog.weight_entered !== null && activeLog.miniset_reps.every(r => r !== null); if (filled) { setActiveLogId(null); setBetweenRestEndsAt(Date.now() + activeExercise.rest_seconds * 1000); return; } await saveLog(activeLog, { status: "completed", completed_at: activeLog.completed_at ?? new Date().toISOString() }); setActiveLogId(null); setBetweenRestEndsAt(Date.now() + activeExercise.rest_seconds * 1000); }}
        onSetWarmupOff={async () => { const link = (workoutRows ?? []).find(x => x.exercise_id === activeLog?.exercise_id && !x.replaced_at && !x.deleted_at); if (link) await repo.setWarmupMode(link.id, "off"); }}
        onToggleWarmup={async (on: boolean) => { const link = (workoutRows ?? []).find(x => x.exercise_id === activeLog?.exercise_id && !x.replaced_at && !x.deleted_at); if (link) await repo.setWarmupMode(link.id, on ? "on" : "off"); }}
        warmupAlwaysAvailable={activeExercise ? (warmupRequired.get(activeExercise.id) ?? false) : false}
        workoutName={activeWorkout?.name ?? ""}
        warmupRequired={activeExercise ? (warmupRequired.get(activeExercise.id) ?? false) : false}
      /> : tab === "Train" && circuitOpen && currentSession && circuitData.available ? <WarmupCircuitView rows={circuitData.rows} workoutName={currentSession.workout_name_snapshot} onBack={() => setCircuitOpen(false)} />
      : tab === "Train" && <section className="train-view">
        <div className="section-heading"><div><p className="overline">TODAY'S TRAINING</p><h1>Pick up where you left off.</h1><p className="lede">One focused working set per exercise. Log it truthfully; let the trend do the talking.</p></div></div>
        <div className="program-picker"><span className="overline">PROGRAM</span><select value={program?.id ?? ""} onChange={e => void setActiveProgram(e.target.value)}>{(programs ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        {currentSession && <div className="resume-card"><span className="badge red-badge">RUNNING</span>Session in progress: <strong>{currentSession.workout_name_snapshot}</strong><span className="session-clock" title="Session duration">{String(Math.floor((now - new Date(currentSession.started_at).getTime()) / 60000)).padStart(2, "0")}:{String(Math.floor(((now - new Date(currentSession.started_at).getTime()) % 60000) / 1000)).padStart(2, "0")}</span><button className="finish-button" onClick={() => void finishCurrentWorkout()}>Finish workout</button><button className="timer-stop" onClick={() => setCancelConfirm(true)}>Cancel</button></div>}
        <div className="workout-switcher">{orderedWorkouts.map((w, i) => {
          const done = workoutLastDone.get(w.id);
          const days = done ? Math.floor((Date.now() - new Date(done).getTime()) / 86400000) : null;
          return <button key={w.id} className={w.id === selected ? "workout-tab active" : "workout-tab"} onClick={() => setSelected(w.id)}>{w.name}{i === 0 ? " · NEXT" : days !== null ? ` · ${days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`}` : " · new"}</button>;
        })}</div>
        <div className="workout-head"><div><span className="overline">ACTIVE PROGRAM · {program?.name}</span><h2>{activeWorkout?.name ?? "Workout"}</h2></div><div className="workout-actions">{currentSession && <button className={circuitData.available ? "button-secondary" : "button-secondary disabled"} title={circuitData.available ? "Warm-up circuit" : ""} onClick={() => { if (circuitData.available) setCircuitOpen(true); else setCircuitInfo(true); }}>Warm-up circuit ⓘ</button>}{currentSession && currentSession.workout_id === selected && <><button className="button-secondary finish-button" onClick={() => void finishCurrentWorkout()}>Finish workout</button><button className="button-secondary" onClick={() => setCancelConfirm(true)}>Cancel session</button></>}{!currentSession && <button className="button-primary" onClick={() => { if (activeWorkout) setStartFlags({ workoutId: activeWorkout.id, deload: false, illness: false }); }}>Start session</button>}{!lockedDefault && <button className="button-secondary" onClick={() => setShowAdd(true)}>＋ Add exercise</button>}</div></div>
        <div className="exercise-list">{joined.map(({ row, ex }, i) => {
          const state = rowState.get(ex.id);
          return <article className="exercise-row clickable" key={row.id} onClick={e => { if ((e.target as HTMLElement).closest("button")) return; void beginExercise(ex.id); }}>
            <span className="exercise-index">{String(i + 1).padStart(2, "0")}</span>
            <div className="exercise-info"><h3>{ex.name}</h3><p>{muscleGroupName(ex.muscle_group)} · {ex.equipment.join(" / ")}{state?.last ? ` · Last: ${state.last.weight_entered ?? "—"} × ${state.last.miniset_reps.map(x => x ?? "–").join("/")}` : ""}</p></div>
            {state?.painFlag && <span className="badge pain-badge" title="Pain flagged last time">⚠ PAIN</span>}
            <span className={`status-tag status-${state?.todayStatus ?? "not_started"}`}>{({ not_started: "READY", in_progress: "IN PROGRESS", completed: "✓ DONE", skipped: "SKIPPED" })[state?.todayStatus ?? "not_started"]}</span>
            {state && state.stagnation === 1 && <span className="badge amber-badge">Last chance</span>}
            {state && state.stagnation >= 2 && <span className="badge red-badge">Switch recommended</span>}
            {state && state.spark.length >= 2 && (() => {
              const vals = state.spark; const min = Math.min(...vals), max = Math.max(...vals);
              const pts = vals.map((v, i) => `${4 + i * (56 / Math.max(1, vals.length - 1))},${14 - (max === min ? 5 : Math.round(((v - min) / (max - min)) * 10))}`).join(" ");
              return <svg className="row-spark" viewBox="0 0 64 18" aria-hidden="true"><polyline points={pts} fill="none" /></svg>;
            })()}
            <div className="row-controls">
              {!lockedDefault && <>
                <button className="row-action" aria-label={`Move ${ex.name} up`} onClick={() => void moveExercise(row.id, -1)}>↑</button>
                <button className="row-action" aria-label={`Move ${ex.name} down`} onClick={() => void moveExercise(row.id, 1)}>↓</button>
              </>}
              <button className="row-action" aria-label={`Open ${ex.name}`} onClick={() => void beginExercise(ex.id)}>›</button>
              {!lockedDefault && <button className="row-action danger" aria-label={`Remove ${ex.name}`} onClick={() => setRemoveConfirm({ linkId: row.id, name: ex.name })}>×</button>}
            </div>
          </article>;
        })}</div>
        {betweenRestEndsAt && betweenRestEndsAt > now && <div className="between-rest"><span className="overline">NEXT EXERCISE IN</span><strong>{Math.ceil((betweenRestEndsAt - now) / 1000)}s</strong><button className="timer-stop" onClick={() => setBetweenRestEndsAt(null)}>Skip</button></div>}
        <div className="protocol-card"><span className="protocol-number">01</span><div><strong>Same weight. Three all-in efforts.</strong><p>Work to clean-form failure, rest 27 seconds, repeat twice. Finish the last good rep; don't force the ugly one.</p></div></div>
      </section>}
      {tab === "Programs" && <ProgramsView programs={programs ?? []} activeProgram={program} allWorkouts={allWorkouts ?? []} allLinks={allLinks ?? []} splitName={splitName} setSplitName={setSplitName} setActiveProgram={setActiveProgram} addSplit={addSplit} />}
      {tab === "History" && <HistoryView exercises={exercises ?? []} unit={unit} />}
      {tab === "Guide" && <Guide />}
      {tab === "Extra" && <ExtraView slug={articleSlug} onOpen={setArticleSlug} />}
      {tab === "Settings" && <SettingsView settings={settings} unit={unit} setUnits={setUnits} authUser={authUser} serverAvailable={serverAvailable} syncUrlConfigured={!!sync.getServerUrl()} onLogout={() => void handleLogout()} onShowAuth={() => setSkipAuthScreen(false)} />}
    </main>
    <nav className="tabbar">{tabs.map(t => <button key={t} className={tab === t ? "nav-item active" : "nav-item"} onClick={() => setTab(t)}><span className="nav-icon">{({Train:"◒",Programs:"▤",History:"↗\uFE0E",Guide:"≡",Extra:"✦",Settings:"⚙\uFE0E"})[t]}</span>{t}</button>)}</nav>
    {showProgramForm && <div className="modal-backdrop" onClick={() => setShowProgramForm(false)}><div className="modal-panel" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><p className="overline">PROGRAM SETUP</p><h2>Create a program</h2></div><button className="close-button" onClick={()=>setShowProgramForm(false)}>×</button></div><p className="lede">A program groups workout splits. The first split is created with it; add more from the program card.</p><label className="form-label">Program name<input value={programName} onChange={e=>setProgramName(e.target.value)} placeholder="e.g. Strength block" /></label><label className="form-label">First workout split<input value={splitName} onChange={e=>setSplitName(e.target.value)} placeholder="e.g. Upper A" /></label><div className="modal-actions"><button className="button-secondary" onClick={()=>setShowProgramForm(false)}>Cancel</button><button className="button-primary" onClick={()=>void createNewProgram(programName,splitName)}>Create & activate</button></div></div></div>}
    {showAdd && <AddExerciseModal onClose={() => setShowAdd(false)} workoutName={activeWorkout?.name ?? ""} onAddLibrary={key => void addExercise(key)} onCustom={() => { setShowAdd(false); setShowCustomForm(true); }} />}
  {removeConfirm && <div className="modal-backdrop" onClick={() => setRemoveConfirm(null)}><div className="modal-panel" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><p className="overline">REMOVE EXERCISE</p><h2>Remove {removeConfirm.name}?</h2></div><button className="close-button" onClick={()=>setRemoveConfirm(null)}>×</button></div><p className="lede">This removes {removeConfirm.name} from this workout's list. Its history is kept, and you can add it back any time.</p><div className="modal-actions"><button className="button-secondary" onClick={()=>setRemoveConfirm(null)}>Keep it</button><button className="button-primary" onClick={() => { void removeExercise(removeConfirm.linkId); setRemoveConfirm(null); }}>Remove from workout</button></div></div></div>}
  {startFlags && <div className="modal-backdrop" onClick={() => setStartFlags(null)}><div className="modal-panel" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><p className="overline">SESSION SETUP</p><h2>Start {activeWorkout?.name ?? "workout"}?</h2></div><button className="close-button" onClick={() => setStartFlags(null)}>×</button></div><p className="lede">Optional: mark this session so it doesn't count toward progress or stagnation.</p><div className="history-toggles"><label><input type="checkbox" checked={startFlags.deload} onChange={e => setStartFlags({ ...startFlags, deload: e.target.checked })} /> Deload week (training light)</label><label><input type="checkbox" checked={startFlags.illness} onChange={e => setStartFlags({ ...startFlags, illness: e.target.checked })} /> Feeling ill / run-down</label></div><div className="modal-actions"><button className="button-secondary" onClick={() => setStartFlags(null)}>Cancel</button><button className="button-primary" onClick={async () => { if (!program || !activeWorkout || !exercises) return; unlockAudio(); const s = await startOrResumeSession(program.id, activeWorkout, exercises); if (startFlags.deload || startFlags.illness) { const row = await db.sessions.get(s.id); if (row) { if (startFlags.deload) await repo.toggleSessionFlag(row, "is_deload", true); if (startFlags.illness) await repo.toggleSessionFlag(row, "is_illness", true); } } setSessionId(s.id); localStorage.setItem("rp-current-session", s.id); setStartFlags(null); }}>Start session</button></div></div></div>}
  {circuitInfo && <div className="modal-backdrop" onClick={() => setCircuitInfo(false)}><div className="modal-panel" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><p className="overline">WARM-UP CIRCUIT</p><h2>Not available yet</h2></div><button className="close-button" onClick={() => setCircuitInfo(false)}>×</button></div><p className="lede">{circuitUnavailableReason}</p><div className="modal-actions"><button className="button-secondary" onClick={() => setCircuitInfo(false)}>OK</button><a className="button-secondary" href="#/Extra/article/saving-time" onClick={() => setCircuitInfo(false)}>Why circuits save time</a></div></div></div>}
  {cancelConfirm && currentSession && <div className="modal-backdrop" onClick={() => setCancelConfirm(false)}><div className="modal-panel" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><p className="overline">CANCEL SESSION</p><h2>Cancel this workout?</h2></div><button className="close-button" onClick={() => setCancelConfirm(false)}>×</button></div><p className="lede">Everything logged in this session (weights and reps) will be permanently deleted. Your history stays untouched.</p><div className="modal-actions"><button className="button-secondary" onClick={() => setCancelConfirm(false)}>Keep going</button><button className="button-primary" onClick={() => void cancelCurrentWorkout()}>Cancel session</button></div></div></div>}
  {finishSummary && <FinishSummaryModal data={finishSummary} onClose={() => setFinishSummary(null)} />}
  {showCustomForm && <CustomExerciseModal onClose={() => setShowCustomForm(false)} unit={unit} onCreated={() => { setShowCustomForm(false); }} workoutId={selected} />}
  </div>;
}

/** Local test-phase auth (user-approved 2026-09-30): open registration, username+password,
 * no email verification/recovery, both come with the hosted/Supabase phase. */
function AuthScreen(props: { onSkip: () => void; onAuth: (username: string, password: string, mode: "login" | "register") => Promise<void> }) {
  const { onSkip, onAuth } = props;
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    try { await onAuth(username.trim(), password, mode); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="auth-shell">
    <div className="auth-card">
      <img className="brand-mark big" src={brandMark} alt="Magnus Profectus mark" />
      <h1>{APP_NAME}</h1>
      <p className="lede">Create an account to keep your exercises, workouts, programs, settings and history on every device you log in from.</p>
      <div className="unit-switch">{(["login", "register"] as const).map(m => <button key={m} className={mode === m ? "selected" : ""} onClick={() => { setMode(m); setError(null); }}>{m === "login" ? "Log in" : "Create account"}</button>)}</div>
      <label className="form-label">Username<input value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. lift_log" autoCapitalize="none" /></label>
      <label className="form-label">Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "register" ? "At least 6 characters" : "Password"} onKeyDown={e => { if (e.key === "Enter" && username && password) void submit(); }} /></label>
      {error && <p className="small-note red-note">{error}</p>}
      <button className="button-primary" disabled={busy || !username.trim() || !password} onClick={() => void submit()}>{busy ? "…" : mode === "login" ? "Log in" : "Create account"}</button>
      <p className="small-note">Testing phase: accounts are username + password only, no email verification or password recovery yet. <button className="link-button" onClick={onSkip}>Continue without an account (this browser only)</button></p>
    </div>
  </div>;
}

/** §7.8: fast custom-exercise path, name + muscle group required; everything else optional under "More options". */
function CustomExerciseModal(props: { onClose: () => void; unit: "kg" | "lb"; workoutId: string | null; onCreated: (id: string) => void }) {
  const { onClose, unit, workoutId, onCreated } = props;
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [setupNotes, setSetupNotes] = useState("");
  const [baseWeight, setBaseWeight] = useState("");
  const [perSide, setPerSide] = useState(false);
  const [unilateral, setUnilateral] = useState(false);
  const [safety, setSafety] = useState(false);
  const [restSeconds, setRestSeconds] = useState("27");
  const [set1Target, setSet1Target] = useState("6");
  const [msCount, setMsCount] = useState("3");
  const suggestedCount = recovery.suggestMiniSetCount(Number(restSeconds) || 27, Number(set1Target) || 6);
  const [error, setError] = useState<string | null>(null);
  const groups: Array<[string, string]> = [["chest","Chest"],["back","Back"],["shoulders","Shoulders"],["traps","Traps"],["biceps","Biceps"],["triceps","Triceps"],["forearms","Forearms"],["quads","Quads"],["hamstrings_glutes","Hamstrings & glutes"],["calves","Calves"],["abs","Abs"]];
  const equipmentOptions = ["barbell","dumbbell","machine","cable","bodyweight","bench","other"];
  async function save() {
    if (!name.trim()) { setError("Give the exercise a name."); return; }
    if (!group) { setError("Pick a muscle group (drives warm-ups and swap suggestions)."); return; }
    const count = Number(msCount);
    if (!(count >= 1 && count <= 5)) { setError("Partial set count must be 1–5."); return; }
    const rest = Number(restSeconds);
    if (!(rest >= 5 && rest <= 120)) { setError("Rest must be 5–120 seconds."); return; }
    // §7.8/§11: technique reminder before saving a custom exercise
    const saved = await repo.createExercise({
      name: name.trim(), muscle_group: group as Exercise["muscle_group"], equipment: equipment as Exercise["equipment"] || ["other"],
      library_key: null, setup_notes: setupNotes.trim(), base_weight: baseWeight === "" ? null : Number(baseWeight),
      base_weight_unit: baseWeight === "" ? null : unit, per_side: perSide, unilateral,
      increment: 5, increment_unit: unit, miniset_count: count,
      miniset_targets: recovery.deriveTargets(rest, Number(set1Target) || 6, count),
      total_target_min: 12, total_target_max: 15, rest_seconds: rest, safety_flag: safety, technique_confirmed: true,
    });
    if (workoutId) await repo.addExerciseToWorkout(workoutId, saved.id);
    onCreated(saved.id);
  }
  return <div className="modal-backdrop" onClick={onClose}><div className="modal-panel" onClick={e => e.stopPropagation()}>
    <div className="modal-head"><div><p className="overline">CUSTOM EXERCISE</p><h2>Create an exercise</h2></div><button className="close-button" onClick={onClose}>×</button></div>
    <label className="form-label">Name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. chest-supported row" autoFocus /></label>
    <div className="form-label">Muscle group<div className="group-picker">{groups.map(([k, label]) => <button key={k} className={group === k ? "group-chip selected" : "group-chip"} onClick={() => setGroup(k)}>{label}</button>)}</div></div>
    <button className="more-options-toggle" onClick={() => setShowMore(!showMore)}>{showMore ? "− Fewer options" : "＋ More options (all optional)"}</button>
    {showMore && <div className="more-options">
      <div className="form-label">Equipment<div className="group-picker">{equipmentOptions.map(eq => <button key={eq} className={equipment.includes(eq) ? "group-chip selected" : "group-chip"} onClick={() => setEquipment(prev => prev.includes(eq) ? prev.filter(x => x !== eq) : [...prev, eq])}>{eq}</button>)}</div></div>
      <label className="form-label">Setup notes (seat height, grip…)<input value={setupNotes} onChange={e => setSetupNotes(e.target.value)} placeholder="optional" /></label>
      <div className="option-row">
        <label className="form-label">Base weight<input inputMode="decimal" value={baseWeight} onChange={e => setBaseWeight(e.target.value)} placeholder="e.g. 20 (bar)" /></label>
        <label className="form-label">Rest seconds<input inputMode="numeric" value={restSeconds} onChange={e => setRestSeconds(e.target.value)} /></label>
        <label className="form-label">Set-1 target reps<input inputMode="numeric" value={set1Target} onChange={e => setSet1Target(e.target.value)} /></label>
      </div>
      <div className="derived-preview">
        <span className="overline">DERIVED FROM REST {restSeconds}s · SET-1 × {set1Target}</span>
        <p>{recovery.deriveTargets(Number(restSeconds), Number(set1Target) || 6, Number(msCount) || 3).map((t: [number, number]) => t[0] + "–" + t[1]).join(" · ")} over {Number(msCount) || 3} partial set{Number(msCount) === 1 ? "" : "s"} ({Math.round(recovery.retention(Number(restSeconds) || 27) * 100)}% capacity kept per rest)</p>
        {suggestedCount !== (Number(msCount) || 3) && <p className="derived-hint">The model suggests {suggestedCount} partial set{suggestedCount === 1 ? "" : "s"} for this rest period.</p>}
        <label className="form-label">Partial sets<input inputMode="numeric" value={msCount} onChange={e => setMsCount(e.target.value)} /></label>
      </div>
      <label className="check-row"><input type="checkbox" checked={perSide} onChange={e => setPerSide(e.target.checked)} /> Weight entered per side of the bar</label>
      <label className="check-row"><input type="checkbox" checked={unilateral} onChange={e => setUnilateral(e.target.checked)} /> Unilateral (log the weaker side)</label>
      <label className="check-row"><input type="checkbox" checked={safety} onChange={e => setSafety(e.target.checked)} /> Needs safety arms or a spotter</label>
    </div>}
    {error && <div className="banner red">{error}</div>}
    <div className="modal-actions"><button className="button-secondary" onClick={onClose}>Cancel</button><button className="button-primary" onClick={() => void save()}>Create & add</button></div>
  </div></div>;
}

/** §7.8/§11: exercise library with a fast "Create custom" path. */
function AddExerciseModal(props: { onClose: () => void; workoutName: string; onAddLibrary: (key: string) => void; onCustom: () => void }) {
  const { onClose, workoutName, onAddLibrary, onCustom } = props;
  const [filter, setFilter] = useState("");
  const filtered = exerciseLibrary.filter(item => item.name.toLowerCase().includes(filter.toLowerCase()));
  return <div className="modal-backdrop" onClick={onClose}><div className="modal-panel" onClick={e => e.stopPropagation()}><div className="modal-head"><div><p className="overline">EXERCISE LIBRARY</p><h2>Add an exercise</h2></div><button className="close-button" onClick={onClose}>×</button></div><p className="lede">Choose a movement for {workoutName}, or create your own.</p><input className="library-filter" placeholder="Filter…" value={filter} onChange={e => setFilter(e.target.value)} /><button className="button-primary custom-create" onClick={onCustom}>＋ Create custom exercise</button><div className="library-list">{filtered.map(item => <button key={item.key} className="library-row" onClick={() => onAddLibrary(item.key)}><span><strong>{item.name}</strong><small>{muscleGroupName(item.muscle_group)} · {item.equipment.join(" / ")}</small></span><b>＋</b></button>)}</div></div></div>;
}

function FinishSummaryModal(props: { data: FinishSummaryData; onClose: () => void }) {
  const { data, onClose } = props;
  // §7.7: deload/illness still editable in the summary
  const [deload, setDeload] = useState(data.session.is_deload);
  const [illness, setIllness] = useState(data.session.is_illness);
  const pct = data.priorLoad !== null && data.priorLoad > 0 ? Math.round(((data.workoutLoad - data.priorLoad) / data.priorLoad) * 1000) / 10 : null;
  const trend = pct === null ? null : pct > 0 ? "improved" : pct < 0 ? "regressed" : "same";
  const skipped = data.rows.filter(r => r.log.status !== "completed").length;
  async function toggleFlag(key: "is_deload" | "is_illness", value: boolean) {
    if (key === "is_deload") setDeload(value); else setIllness(value);
    const row = await db.sessions.get(data.session.id);
    if (row) await repo.toggleSessionFlag(row, key, value);
  }
  return <div className="modal-backdrop" onClick={onClose}><div className="modal-panel summary-panel" onClick={e => e.stopPropagation()}>
  <div className="modal-head"><div><p className="overline">WORKOUT COMPLETE</p><h2>{data.session.workout_name_snapshot}</h2></div><button className="close-button" onClick={onClose}>×</button></div>
  <div className="summary-grid">
    <div className="summary-tile"><span className="overline">DURATION</span><strong>{data.durationMin} min</strong></div>
    <div className="summary-tile"><span className="overline">{data.isRepsOnly ? "EXERCISES" : "TOTAL LOAD"}</span><strong>{data.isRepsOnly ? `${data.rows.filter(r => r.log.status === "completed").length}` : `${Math.round(data.workoutLoad)} kg`}{trend && <span className={`trend trend-${trend}`}>{trend === "improved" ? " ↑" : trend === "same" ? " =" : " ↓"} {pct !== null && `${pct > 0 ? "+" : ""}${pct}%`}</span>}{data.priorLoad === null && <small className="baseline"> baseline</small>}</strong><small className="summary-sub">{data.priorLoad !== null ? `vs ${Math.round(data.priorLoad)} kg last ${data.session.workout_name_snapshot}` : "first session of this workout"}</small></div>
    <div className="summary-tile"><span className="overline">PROGRESSED</span><strong>{data.progressed} of {data.eligibleCount}</strong><small className="summary-sub">primary indicator</small></div>
  </div>
  {(deload || illness) && <div className="banner amber">This session is marked {deload ? "deload" : "illness"}, it won't count toward progress or stagnation.</div>}
  {skipped > 0 && <div className="banner amber">{skipped} exercise{skipped === 1 ? "" : "s"} skipped or unfinished this session.</div>}
  <div className="summary-rows">{data.rows.map(({ log, name }) => <div className="history-log-row" key={log.id}>
    <strong>{name}</strong>
    <span>{({ completed: "✓", skipped: "— skipped", in_progress: "… unfinished", not_started: "– not started" })[log.status]}{log.status === "completed" ? ` · ${log.weight_entered ?? "—"} ${log.weight_unit} × ${log.miniset_reps.map(x => x ?? "–").join("/")}` : ""}{log.pain ? " · ⚠ pain" : ""}</span>
  </div>)}</div>
  <div className="history-toggles"><label><input type="checkbox" checked={deload} onChange={e => void toggleFlag("is_deload", e.target.checked)} /> Deload</label><label><input type="checkbox" checked={illness} onChange={e => void toggleFlag("is_illness", e.target.checked)} /> Feeling ill</label><small className="summary-sub">Logged normally but won't count toward progress or stagnation.</small></div>
  <div className="modal-actions"><button className="button-primary" onClick={onClose}>Done</button></div>
  </div></div>;
  }

  /** §7.5 Exercise chart: inline SVG, X = session number, Y = capped load (or reps). */
  function ExerciseChart(props: { logs: Array<ExerciseLog & { is_deload?: boolean; is_illness?: boolean }>; unitLabel: string; displayUnit: "kg" | "lb" }) {
  const { logs, unitLabel, displayUnit } = props;
  const [expanded, setExpanded] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; text: string } | null>(null);
  const completed = logs.filter(l => l.status === "completed").sort((a, b) => (a.completed_at ?? "").localeCompare(b.completed_at ?? ""));
  if (completed.length === 0) return <p className="small-note">No completed sessions yet, the chart appears after your first logged set.</p>;
  const shown = expanded ? completed : completed.slice(-10);
  const fmt = (log: ExerciseLog) => isRepsOnlyLog(log)
  ? cappedReps({ miniset_reps: log.miniset_reps, targets_snapshot: log.targets_snapshot })
  : Math.round(displayValue(cappedLoadKg({ ...log, weight_kg: log.weight_kg ?? 0 }), "kg", displayUnit));
  const values = shown.map(fmt);
  const minV = Math.min(...values), maxV = Math.max(...values);
  const pad = { l: 44, r: 12, t: 14, b: 26 };
  const W = 560, H = 200;
  const spanV = Math.max(1, maxV - minV);
  const x = (i: number) => pad.l + (shown.length === 1 ? (W - pad.l - pad.r) / 2 : i * (W - pad.l - pad.r) / (shown.length - 1));
  const y = (v: number) => pad.t + (1 - (v - minV) / spanV) * (H - pad.t - pad.b);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return <div className="chart-block">
  <div className="chart-head"><span className="overline">CAPPED {unitLabel.toUpperCase()} BY SESSION</span>{completed.length > 10 && <button className="button-secondary chart-expand" onClick={() => setExpanded(!expanded)}>{expanded ? "Show last 10" : "Expand all"}</button>}</div>
  <svg viewBox={`0 0 ${W} ${H}`} className="exercise-chart" role="img" aria-label="Progress chart">
    {[0, 0.5, 1].map(f => (
      <g key={f}>
        <line x1={pad.l} x2={W - pad.r} y1={y(minV + f * spanV)} y2={y(minV + f * spanV)} className="chart-grid" />
        <text x={pad.l - 6} y={y(minV + f * spanV) + 4} textAnchor="end" className="chart-label">{Math.round(minV + f * spanV)}</text>
      </g>
    ))}
    <line x1={x(0)} x2={x(0)} y1={pad.t} y2={H - pad.b} className="chart-baseline" />
    <polyline points={points} className="chart-line" fill="none" />
    {shown.map((log, i) => {
      const hollow = log.pain || log.is_deload || log.is_illness;
      return <g key={log.id} onClick={e => setTooltip({ x: (e.nativeEvent as PointerEvent).offsetX, text: `${log.completed_at ? new Date(log.completed_at).toLocaleDateString() : ""} · ${log.weight_entered ?? "—"} ${log.weight_unit} × ${log.miniset_reps.map(v => v ?? "–").join("/")} · ${fmt(log)} ${unitLabel}${log.pain ? " · ⚠" : ""}${log.is_deload ? " · deload" : ""}${log.is_illness ? " · ill" : ""}` })}>
        <circle cx={x(i)} cy={y(values[i])} r={7} fill="transparent" />
        <circle cx={x(i)} cy={y(values[i])} r={hollow ? 4 : 4.5} className={hollow ? "chart-dot hollow" : "chart-dot"} />
        {(() => {
          const prev = shown[i - 1];
          const star = prev && !isRepsOnlyLog(log) && realLoadKg(log) > realLoadKg(prev) && totalReps({ miniset_reps: log.miniset_reps }) >= log.targets_snapshot.total_min;
          return star ? <text x={x(i)} y={y(values[i]) - 8} textAnchor="middle" className="chart-star">★</text> : null;
        })()}
      </g>;
    })}
    {shown.map((_, i) => (shown.length > 1 && (i % Math.ceil(shown.length / 8) === 0 || i === shown.length - 1)) ? <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="chart-label">{i + 1}</text> : null)}
  </svg>
  {tooltip && <div className="chart-tooltip" onClick={() => setTooltip(null)}>{tooltip.text}</div>}
  </div>;
  }
  function realLoadKg(log: ExerciseLog): number {
  return (log.base_weight_kg_snapshot ?? 0) + (log.weight_kg ?? 0) * (log.per_side_snapshot ? 2 : 1);
  }

function ExerciseLogger(props: {
  exercise: Exercise; log: ExerciseLog; previous?: ExerciseLog;
  settings: { units: "kg" | "lb"; warmup_reminder_enabled?: boolean; warmup_scheme?: Array<{ pct: number; reps: number }>; theme?: string } | undefined;
  now: number; timerEnd: number | null;
  onStartTimer: () => void; onStopTimer: () => void;
  onChange: (patch: Partial<ExerciseLog>) => void; onBack: () => void;
  onSkip: () => void; onSwap: (key: string) => void; onKeep: () => void; onDone: () => void;
  onSetWarmupOff: () => void; onToggleWarmup: (on: boolean) => void; warmupAlwaysAvailable: boolean;
  workoutName: string; warmupRequired: boolean;
}) {
  const { exercise, log, previous, settings, now, timerEnd, onStartTimer, onStopTimer, onChange, onBack, onSkip, onSwap, onKeep, onDone, onSetWarmupOff, onToggleWarmup, warmupAlwaysAvailable, workoutName, warmupRequired } = props;
  const [swapOpen, setSwapOpen] = useState(false);
  const [warmupPrompt, setWarmupPrompt] = useState(false);
  const [painNoteMissing, setPainNoteMissing] = useState(false);
  const shownReps = log.miniset_reps;
  const weight = log.weight_entered;
  const reps = totalReps({ miniset_reps: shownReps });
  const targets = log.targets_snapshot;
  const cap = cappedReps({ miniset_reps: shownReps, targets_snapshot: targets });
  const perRepKg = (log.base_weight_kg_snapshot ?? 0) + (log.weight_kg ?? 0) * (log.per_side_snapshot ? 2 : 1);
  const repsOnly = perRepKg === 0;
  const load = repsOnly ? cap : perRepKg * cap;
  // recommendation (§6.7): last eligible log of this exercise, live via useLiveQuery so it
  // refreshes after completing a set within the same visit (user-reported gap).
  const liveHistory = useLiveQuery(() => db.exercise_logs.where("exercise_id").equals(exercise.id).filter(x => !x.deleted_at).toArray(), [exercise.id], [] as ExerciseLog[]);
  const history = liveHistory ?? [];
  const recommendation = useMemo(() => recommendWeight(history as unknown as import("./domain/types").DomainLog[]), [history, weight, exercise]);
  const displayUnit = settings?.units ?? log.weight_unit;
  const displayWeightValue = weight === null ? null : displayValue(weight, log.weight_unit, displayUnit);
  // stagnation (§6.5)
  const stag = stagnationCount(history as unknown as import("./domain/types").DomainLog[], { baseline_reset_at: exercise.baseline_reset_at, stagnation_dismissed_at: exercise.stagnation_dismissed_at });
  // session result vs prev (§6.6)
  const result = previous ? compareResult(
    { ...log, is_deload: false, is_illness: false, created_at: log.created_at, status: "completed" } as DomainLogView,
    { ...previous, is_deload: false, is_illness: false, created_at: previous.created_at } as DomainLogView,
    false,
  ) : null;
  // pain gate (§7.4.2): trigger on the most recent completed log of this exercise (any session)
  const [painAck, setPainAck] = useState(false);
  const mostRecentCompleted = history.filter(x => x.status === "completed").sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0];
  const painGateOpen = mostRecentCompleted?.pain === true && !painAck && mostRecentCompleted.id !== log.id;
  // default focus: weight input takes focus once, when the exercise view opens.
  // A ref callback would re-run on every autosave re-render and steal focus from
  // the rep inputs, so this is an effect keyed to the log id instead.
  const weightInputRef = (input: HTMLInputElement | null) => { weightInputEl.current = input; };
  const weightInputEl = { current: null as HTMLInputElement | null };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const gated = painGateOpen || warmupPrompt || swapOpen;
      const anyFieldFocused = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLButtonElement;
      if (!gated && !anyFieldFocused) weightInputEl.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.id]);
  // warm-up confirmation (§7.4.6)
  const [warmupNeeded, setWarmupNeeded] = useState(false);
  useEffect(() => { setWarmupNeeded(false); setPainAck(false); }, [log.id]);
  // Warm-up reminder timing (user-revised 2026-10): fires when the weight input is
  // LEFT (blur, or scrolled out of view) with a valid weight entered, after the
  // working weight is committed but before the first rep. Doesn't interrupt weight
  // typing, doesn't wait for rep entry.
  function onWeightCommitted(committed?: number | null) {
    const w = committed !== undefined ? committed : weight;
    if (w !== null && settings?.warmup_reminder_enabled !== false && !log.warmup_confirmed && !warmupNeeded) setWarmupPrompt(true);
  }
  // scroll-away commit: weight input leaving the viewport counts as committed
  useEffect(() => {
    const onScroll = () => {
      const el = document.getElementById("working-weight") as HTMLInputElement | null;
      if (!el || warmupPrompt) return;
      const r = el.getBoundingClientRect();
      // read the raw input value (state may lag one tick behind the last keystroke)
      if ((r.bottom < 0 || r.top > window.innerHeight) && el.value !== "" && Number(el.value) > 0) onWeightCommitted(Number(el.value));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  });
  // tap/click commit: clicking anywhere outside the weight input counts as committed
  // (mobile blur is unreliable; pointerdown always fires)
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const el = document.getElementById("working-weight") as HTMLInputElement | null;
      if (!el || warmupPrompt) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      const v = Number(el.value);
      if (el.value !== "" && v > 0) onWeightCommitted(v);
    };
    document.addEventListener("pointerdown", onPointer, { passive: true });
    return () => document.removeEventListener("pointerdown", onPointer);
  });
  const warmups = calculateWarmups({ workingEntry: weight, workingUnit: log.weight_unit, labelUnit: displayUnit, baseWeight: exercise.base_weight, baseWeightUnit: exercise.base_weight_unit, perSide: exercise.per_side, scheme: [{ pct: 0.5, reps: 15 }, { pct: 0.75, reps: 7 }, { pct: 0.9, reps: 3 }] });
  const remaining = timerEnd ? Math.ceil(remainingMs({ endsAt: timerEnd, mode: "miniset", startedAt: null }, now) / 1000) : 0;
  const lastWeight = previous?.weight_entered ?? null;
  const newWeight = weight !== null && lastWeight !== null && weight !== lastWeight;
  const fmtLoad = (v: number) => repsOnly ? String(Math.round(v)) : `${formatNumber(displayValue(v, "kg", displayUnit))}`;
  return <section className="logger-view">
    <button className="back-link" onClick={onBack}>‹ Return to Workout</button>
    <p className="overline">{workoutName} · {exercise.muscle_group.replaceAll("_", " ")} · WORKING SET</p>
    <h1><EditableName value={exercise.name} onSave={name => { void repo.updateExerciseRowPublic(exercise.id, { name }); }} /></h1>
    {exercise.setup_notes && <p className="lede">{exercise.setup_notes}</p>}
    {exercise.safety_flag && <div className="safety-note">⚠ Use safety arms or a spotter when training to failure.</div>}
    {exercise.unilateral && <p className="small-note">Log the reps of your weaker side. Start the timer after both sides.</p>}
    {painGateOpen && <div className="modal-backdrop"><div className="modal-panel"><div className="modal-head"><div><p className="overline">PAIN FLAG</p><h2>Last time you flagged pain{mostRecentCompleted?.pain_note ? `: ${mostRecentCompleted.pain_note}` : ""}.</h2></div></div><p className="lede">Take it carefully today.</p><div className="modal-actions"><button className="button-secondary" onClick={onSkip}>Skip today</button><button className="button-secondary" onClick={() => setSwapOpen(true)}>Swap exercise</button><button className="button-primary" onClick={() => setPainAck(true)}>Continue with caution</button></div></div></div>}
    {stag === 1 && <div className="banner amber">No progress last time. Beat your recent best today to keep this exercise.</div>}
    {stag === 2 && <div className="banner amber">Two sessions without progress. One more and this exercise should be swapped.</div>}
    {stag >= 3 && <div className="banner red">Three sessions without progress. This exercise has done its job. <button onClick={onKeep}>Keep exercise</button><button onClick={() => setSwapOpen(true)}>Choose replacement</button></div>}
    {previous && <div className={`last-card${previous.pain ? " pain-highlight" : ""}`}><span className="overline">LAST TIME{previous.pain ? " · ⚠ PAIN FLAGGED" : ""}</span><strong>{previous.weight_entered ?? "—"} {previous.weight_unit} · {previous.miniset_reps.map(x => x ?? "–").join(" / ")}</strong><span className="last-score">{repsOnly ? `${cappedReps({ miniset_reps: previous.miniset_reps, targets_snapshot: previous.targets_snapshot })} reps` : `${formatNumber(cappedLoadKg({ miniset_reps: previous.miniset_reps, targets_snapshot: previous.targets_snapshot, weight_kg: previous.weight_kg ?? 0, base_weight_kg_snapshot: previous.base_weight_kg_snapshot ?? 0, per_side_snapshot: previous.per_side_snapshot }))} ${displayUnit} load`}{previous.rating ? ` · rated ${previous.rating}` : ""}{previous.pain ? ` · ${previous.pain_note || "pain noted"}` : ""}</span></div>}
    {!previous && <div className="last-card"><span className="overline">FIRST TIME</span><strong>Pick a weight you can lift for about 7 good reps.</strong></div>}
    <div className="logger-grid"><div className="logger-main">
      <label className="field-label" htmlFor="working-weight">Working weight <span>{displayUnit}{exercise.per_side ? " per side" : ""}</span></label>
      <div className="weight-entry"><button onClick={() => void onChange({ weight_entered: Math.max(0, (weight ?? 0) - convert(2.5, displayUnit, log.weight_unit)) })}>−</button><input id="working-weight" ref={weightInputRef} inputMode="decimal" type="number" step="any" value={displayWeightValue ?? ""} placeholder={recommendation.direction === "no_history" ? "Enter weight" : recommendation.direction === "increase" ? "↑ heavier" : recommendation.direction === "decrease" ? "↓ lighter" : "Same weight"} onBlur={() => onWeightCommitted()} onChange={e => void onChange({ weight_entered: e.target.value === "" ? null : convert(Number(e.target.value), displayUnit, log.weight_unit) })} /><button onClick={() => void onChange({ weight_entered: (weight ?? 0) + convert(2.5, displayUnit, log.weight_unit) })}>＋</button></div>
      <p className="small-note recommendation">{recommendation.message}</p>
      <p className="small-note">Same weight for all partial sets. Change it next session, not mid-set. Each partial set: as many reps as possible, targets are a weight check, not a stopping point.</p>
      {warmupRequired && warmups.length > 0 && <div className="warmup-block"><span className="overline">WARM-UP SUGGESTION</span>{warmups.map((row, i) => <div key={i} className="warmup-row">{row.label}</div>)}<small className="warmup-note">Rounded down to the nearest {displayUnit}, pick the nearest weight this exercise has.</small></div>}
      <div className="miniset-list">{log.miniset_reps.map((_value, i) => <label className="miniset-row" key={i}><span className="miniset-name">PARTIAL SET {i + 1}<small>{newWeight ? "★ new weight" : `Range ${targets.miniset_targets[i]?.join("–")} · to failure${previous?.miniset_reps[i] != null ? ` · last: ${previous.miniset_reps[i]}` : ""}`}</small></span><button type="button" className="rep-step" aria-label={`Decrease partial set ${i + 1}`} onClick={() => { const n = Math.max(0, (shownReps[i] ?? 0) - 1); void updateMinisetRep(log.id, i, n); }}>−</button><input className="reps-input" inputMode="numeric" type="number" min="0" value={shownReps[i] ?? ""} onChange={e => { void updateMinisetRep(log.id, i, e.target.value === "" ? null : Number(e.target.value)); }} /><button type="button" className="rep-step" aria-label={`Increase partial set ${i + 1}`} onClick={() => { const n = (shownReps[i] ?? 0) + 1; void updateMinisetRep(log.id, i, n); }}>＋</button><span className="reps-unit">reps</span></label>)}</div>
      <div className="rating-row"><span className="overline">RATING</span>{[1, 1.5, 2, 2.5, 3].map(r => <button key={r} className={log.rating === r ? "rating-chip selected" : "rating-chip"} onClick={() => void onChange({ rating: r })}>{r}</button>)}<small>1 = easy · 2 = right · 3 = too heavy</small></div>
      <div className="result-panel"><span className="overline">LIVE RESULT</span><strong>{reps} <small>REPS</small> · {fmtLoad(load)} <small>{repsOnly ? "REPS" : `${displayUnit} LOAD`}</small>{result?.kind === "star" && <span className="star"> ★</span>}{result?.kind === "trend" && <span className={`trend trend-${result.trend}`}>{result.trend === "improved" ? " ↑" : result.trend === "same" ? " =" : " ↓"}{result.pct !== null && ` ${result.pct > 0 ? "+" : ""}${result.pct}%`}</span>}{result?.kind === "baseline" && <span className="trend baseline"> Fresh start</span>}</strong><span className="save-indicator" aria-live="polite">Autosaves</span><p>{reps >= targets.total_max ? `At/above target: go heavier next time. Reps past ${targets.total_max} don't count.` : reps >= targets.total_min ? (result?.kind === "star" ? "★ Heavier weight and reps in range. That's progress." : "In range. Beat this total next time.") : "Below target: go lighter next time."}</p></div>
      <div className="logger-actions">
        <label className="pain-check"><input type="checkbox" checked={log.pain} onChange={e => void onChange({ pain: e.target.checked })} /> PAIN</label>
        <label className="pain-check" title="Warm-up sets for this exercise in this workout"><input type="checkbox" checked={warmupRequired} onChange={e => void onToggleWarmup(e.target.checked)} /> WARM-UP</label>
        {log.pain && <input className="pain-note" placeholder="Where / what hurt? (required, future you needs this)" value={log.pain_note} onChange={e => void onChange({ pain_note: e.target.value })} />}
        <button className="button-secondary" onClick={onSkip}>Skip today</button>
        <button className="button-secondary" onClick={() => setSwapOpen(true)}>Swap exercise</button>
        <button className="button-secondary" onClick={onBack}>Back to workout</button>
        <button className="button-primary" onClick={() => { if (log.pain && !log.pain_note.trim()) { setPainNoteMissing(true); return; } setPainNoteMissing(false); onDone(); }}>{log.pain && !log.pain_note.trim() ? "Add pain note to finish" : "Exercise done"}</button>
        {painNoteMissing && <p className="small-note red-note" style={{ margin: "4px 0 0" }}>You flagged pain, write where/what so next session warns you properly.</p>}
      </div></div>
      <aside className="timer-card"><span className="overline">REST TIMER</span><strong className="timer-digits">{String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}</strong><button className="timer-button" onClick={onStartTimer}>{timerEnd ? "Restart" : "Start 27 sec"}</button>{timerEnd && <button className="timer-stop" onClick={onStopTimer}>Stop timer</button>}<p>Start as soon as the weight is down.</p></aside>
    </div>
    {warmupPrompt && <WarmupDialog onOk={() => { setWarmupPrompt(false); void onChange({ warmup_confirmed: true }); void setWarmupNeeded(false); }} onSkip={() => { setWarmupPrompt(false); setWarmupNeeded(true); void onChange({ warmup_confirmed: true }); }} onSkipAlways={warmupAlwaysAvailable ? () => { setWarmupPrompt(false); setWarmupNeeded(true); void onChange({ warmup_confirmed: true }); void onSetWarmupOff(); } : undefined} weightInputId="working-weight" />}
    {swapOpen && <div className="modal-backdrop" onClick={() => setSwapOpen(false)}><div className="modal-panel" onClick={e => e.stopPropagation()}><div className="modal-head"><div><p className="overline">SWAP EXERCISE</p><h2>Replace {exercise.name}</h2></div><button className="close-button" onClick={() => setSwapOpen(false)}>×</button></div><p className="lede">Same muscle group, not already in this workout.</p><div className="library-list">{exerciseLibrary.filter(item => item.muscle_group === exercise.muscle_group && item.key !== exercise.library_key).map(item => <button key={item.key} className="library-row" onClick={() => { onSwap(item.key); setSwapOpen(false); }}><span><strong>{item.name}</strong><small>{muscleGroupName(item.muscle_group)} · {item.equipment.join(" / ")}</small></span><b>⇄</b></button>)}</div></div></div>}
  </section>;
}

/** Warm-up circuit page (user-requested 2026-10): every warm-up set of the running
 * session on ONE page, ordered set-1-of-each-exercise first (the rotation pattern
 * from the "saving time" article), checkboxes per set, back link. */
function WarmupCircuitView(props: { rows: Array<{ name: string; label: string; setNo: number; pct: number }>; workoutName: string; onBack: () => void }) {
  const { rows, workoutName, onBack } = props;
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setDone(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return <section className="circuit-view">
    <button className="back-link" onClick={onBack}>‹ Return to Workout</button>
    <p className="overline">{workoutName} · WARM-UP CIRCUIT</p>
    <h1>Warm-up circuit</h1>
    <p className="lede">Rotate through all exercises' warm-up sets in one pass, light weights, little rest needed. Working sets come after.</p>
    <p className="small-note">Weights are based on each exercise's last known target weight, from the previous workout, or what you've already entered this session. If you want different working weights today, enter them in the exercises first, then come back here.</p>
    <div className="circuit-list">{rows.map((row, i) => (
      <label className={`circuit-row${done.has(i) ? " done" : ""}`} key={i}>
        <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} />
        <span className="circuit-name">{row.name} <small className="circuit-set-no">Warm-up set {row.setNo} · {Math.round(row.pct * 100)}%</small></span>
        <strong>{row.label}</strong>
      </label>
    ))}</div>
    {done.size === rows.length && rows.length > 0 && <div className="banner">All warm-ups done, hit the working sets.</div>}
  </section>;
}

function WarmupDialog(props: { onOk: () => void; onSkip?: () => void; onSkipAlways?: () => void; weightInputId: string }) {
  const { onOk, onSkip, onSkipAlways, weightInputId } = props;
  // focus OK once on mount; a ref callback would re-focus on every parent re-render
  // (each autosave) and steal focus from whatever the user is typing in
  const okBtnRef = { current: null as HTMLButtonElement | null };
  useEffect(() => { okBtnRef.current?.focus(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const refocus = () => window.setTimeout(() => { document.getElementById(weightInputId)?.focus(); }, 60);
  const handleOk = () => { onOk(); refocus(); };
  const handleSkip = () => { (onSkipAlways ?? onSkip)?.(); refocus(); };
  return <div className="modal-backdrop"><div className="modal-panel"><h2>Warm-up sets done?</h2>{onSkip && <p className="small-note">If this exercise doesn't need warming up (e.g. second exercise for the same muscles), you can skip the reminder.</p>}<div className="modal-actions">{onSkip && <button className="button-secondary" onClick={handleSkip}>{onSkipAlways ? "Skip, not needed for this exercise" : "Skip"}</button>}<button className="button-primary" ref={el => { okBtnRef.current = el; }} onClick={handleOk}>Done</button></div><button className="link-button" onClick={() => { void repo.patchSettings({ warmup_reminder_enabled: false }); onOk(); }}>Don't remind me again (turn off in Settings)</button></div></div>;
}

function EditableName(props: { value: string; onSave: (name: string) => void; className?: string }) {
  const { value, onSave, className } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (editing) return <span className={className}>
    <input className="rename-input" value={draft} autoFocus onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { onSave(draft); setEditing(false); } if (e.key === "Escape") setEditing(false); }} />
    <button className="rename-ok" onClick={() => { onSave(draft); setEditing(false); }}>✓</button>
  </span>;
  return <span className={className} role="button" title="Click to rename" onClick={() => setEditing(true)}>{value}<small className="rename-hint"> ✎</small></span>;
}

function ProgramsView(props: {
  programs: import("./data/db").Program[]; activeProgram?: import("./data/db").Program;
  allWorkouts: import("./data/db").Workout[]; allLinks: WorkoutExercise[];
  splitName: string; setSplitName: (v: string) => void;
  setActiveProgram: (id: string) => void; addSplit: () => void;
}) {
  const { programs: allPrograms, activeProgram, allWorkouts, allLinks, splitName, setSplitName, setActiveProgram, addSplit } = props;
  const [settings, setSettingsState] = useState<import("./data/db").UserSettings | null>(null);
  useEffect(() => { void db.user_settings.get("local").then(s => setSettingsState(s ?? null)); }, []);
  const hiddenIds = settings?.hidden_default_program_ids ?? [];
  const hideAll = settings?.hide_default_programs === 1;
  // visibility: default programs respect the master switch and individual hides;
  // unmaintained (older-version) copies always show, they are the user's own history
  // Hiding applies to every program now (2026-10-07): master switch hides all,
  // per-card Hide hides one; unmaintained copies always show (user's own history).
  const programs = allPrograms.filter(p => {
    if (p.unmaintained) return true;
    if (hideAll) return false;
    return !hiddenIds.includes(p.id);
  });
  async function toggleHideDefault(id: string) {
    const s = await db.user_settings.get("local"); if (!s) return;
    const list = new Set(s.hidden_default_program_ids ?? []);
    if (list.has(id)) list.delete(id); else list.add(id);
    await repo.save(db.user_settings, { ...s, hidden_default_program_ids: [...list] });
    setSettingsState({ ...s, hidden_default_program_ids: [...list] });
  }
  const [deleteProgramConfirm, setDeleteProgramConfirm] = useState<import("./data/db").Program | null>(null);
  const [cloneSource, setCloneSource] = useState<import("./data/db").Program | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneKeepHistory, setCloneKeepHistory] = useState(true);
  async function cloneFn(sourceId: string, name: string) {
    const p = await repo.cloneProgram(sourceId, name, cloneKeepHistory);
    setCloneSource(null); setCloneName(""); setCloneKeepHistory(true);
    setActiveProgram(p.id);
  }
  return <section>
    <div className="program-title-row"><div><p className="overline">PROGRAM LIBRARY</p><h1>Programs</h1></div><button className="button-primary" onClick={() => document.dispatchEvent(new CustomEvent("open-program-form"))}>＋ New program</button></div>
    <p className="lede">A program groups workout splits. Click any name to rename. Activate a program to train its splits. We recommend building your own program, keeping a structure similar to the defaults.</p>
    <div className="program-cards">{programs.map(p => {
      const isLockedDefault = p.is_default === 1 && !p.unmaintained;
      const splits = allWorkouts.filter(w => w.program_id === p.id && !w.deleted_at).sort((a, b) => a.position - b.position);
      return <article className="program-card" key={p.id}>
        <div className="program-card-head">
          <div><h2>{isLockedDefault ? p.name : <EditableName value={p.name} onSave={name => { void db.programs.get(p.id).then(row => { if (row) void repo.save(db.programs, { ...row, name }); }); }} />}</h2><span>{splits.length} workout split{splits.length === 1 ? "" : "s"}</span>{p.is_default === 1 && !p.unmaintained && <span className="default-badge">DEFAULT</span>}{p.unmaintained === 1 && <span className="default-badge old">OLDER VERSION · NO LONGER MAINTAINED</span>}</div>
          <div className="program-card-actions"><button className="row-action" aria-label={`Hide ${p.name}`} title="Hide this program (show again via Settings)" onClick={() => void toggleHideDefault(p.id)}>Hide</button>{p.is_default === 1 && !p.unmaintained && <span className="lock-note" title="Default programs are maintained by the team. Clone to make your own editable copy.">🔒</span>}<button className={p.id === activeProgram?.id ? "active-badge" : "activate-button"} onClick={() => setActiveProgram(p.id)}>{p.id === activeProgram?.id ? "ACTIVE" : "Activate"}</button><button className="row-action" aria-label={`Clone ${p.name}`} title="Clone program (keeps exercise history)" onClick={() => { setCloneSource(p); setCloneName(`${p.name} (copy)`); }}>⧉</button>{!(p.is_default === 1 && !p.unmaintained) && <button className="row-action danger program-delete" aria-label={`Delete ${p.name}`} title="Delete program" onClick={() => setDeleteProgramConfirm(p)}>×</button>}</div>
        </div>
        {splits.map((w, wi) => {
          const count = allLinks.filter(x => x.workout_id === w.id && !x.replaced_at && !x.deleted_at).length;
          const canUp = wi > 0, canDown = wi < splits.length - 1;
          const moveSplit = async (dir: -1 | 1) => {
            const target = splits[wi + dir]; if (!target) return;
            const rows = [...splits]; rows[wi] = target; rows[wi + dir] = w;
            await db.transaction("rw", db.workouts, async () => {
              for (let i = 0; i < rows.length; i++) { const row = await db.workouts.get(rows[i].id); if (row) await repo.save(db.workouts, { ...row, position: i }); }
            });
          };
          return <div className="split-row" key={w.id}>
            {p.id === activeProgram?.id && <span className="split-arrows">{canUp && <button className="row-action" aria-label={`Move ${w.name} up`} onClick={() => void moveSplit(-1)}>↑</button>}{canDown && <button className="row-action" aria-label={`Move ${w.name} down`} onClick={() => void moveSplit(1)}>↓</button>}</span>}
            <span className="split-marker">↳</span>
            <strong>{isLockedDefault ? w.name : <EditableName value={w.name} onSave={name => { void db.workouts.get(w.id).then(row => { if (row) void repo.save(db.workouts, { ...row, name }); }); }} />}</strong>
            <span>{count} exercises</span>
            {p.id === activeProgram?.id && <button aria-label={`Train ${w.name}`} onClick={() => { window.dispatchEvent(new CustomEvent("train-split", { detail: w.id })); }}>Train ›</button>}
          </div>;
        })}
        {p.id === activeProgram?.id && !isLockedDefault && <div className="add-split-row"><input value={splitName} onChange={e => setSplitName(e.target.value)} placeholder="New workout split name" /><button onClick={addSplit}>＋ Add split</button></div>}
        {isLockedDefault && <p className="small-note">This is a default program maintained by the team. Clone it to make an editable copy with your own changes.</p>}
      </article>;
    })}</div>
    {cloneSource && <div className="modal-backdrop" onClick={() => setCloneSource(null)}><div className="modal-panel" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><p className="overline">CLONE PROGRAM</p><h2>Clone {cloneSource.name}</h2></div><button className="close-button" onClick={()=>setCloneSource(null)}>×</button></div><p className="lede">Creates a copy with all workout splits and exercises. The clone is fully editable while the original stays untouched.</p><label className="form-label">Name for the clone<input value={cloneName} onChange={e=>setCloneName(e.target.value)} onKeyDown={async e => { if (e.key === "Enter" && cloneName.trim()) { await cloneFn(cloneSource.id, cloneName); } }} /></label><label className="clone-history-check"><input type="checkbox" checked={cloneKeepHistory} onChange={e=>setCloneKeepHistory(e.target.checked)} /> Keep historical performance for the exercises</label><p className="small-note">Unchecked: every exercise starts with a clean trend, use this if the clone will change rest periods, sets or reps significantly enough that old numbers no longer compare. Checked: "last time" and stagnation follow the exercise as usual.</p><div className="modal-actions"><button className="button-secondary" onClick={()=>setCloneSource(null)}>Cancel</button><button className="button-primary" onClick={async () => { await cloneFn(cloneSource.id, cloneName); }}>Create clone</button></div></div></div>}
    {deleteProgramConfirm && <div className="modal-backdrop" onClick={() => setDeleteProgramConfirm(null)}><div className="modal-panel" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><p className="overline">DELETE PROGRAM</p><h2>Delete {deleteProgramConfirm.name}?</h2></div><button className="close-button" onClick={()=>setDeleteProgramConfirm(null)}>×</button></div><p className="lede">The program and its workout splits are removed. Exercises and their training history are kept and stay available.</p><div className="modal-actions"><button className="button-secondary" onClick={()=>setDeleteProgramConfirm(null)}>Keep it</button><button className="button-primary" onClick={() => { void repo.deleteProgram(deleteProgramConfirm.id); setDeleteProgramConfirm(null); }}>Delete program</button></div></div></div>}
  </section>;
}

/** User-revised 2026-09: back-dating for pen-and-paper entry. Change the session's date
 * in History; started_at moves to the new date (same wall-clock time), finished_at keeps
 * the same duration. All progression/stagnation math reads these timestamps, so the
 * back-entered session slots into the trend as if it had been logged that day. */
function SessionDateEditor(props: { session: import("./data/db").Session }) {
  const { session } = props;
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState("");
  if (!editing) return <div className="date-row"><button className="button-secondary" onClick={() => { setDate(session.started_at.slice(0, 10)); setEditing(true); }}>Change date</button></div>;
  const shift = async () => {
    if (!date) { setEditing(false); return; }
    const oldStart = new Date(session.started_at);
    const newStart = new Date(`${date}T${oldStart.toTimeString().slice(0, 8)}`);
    const deltaMs = newStart.getTime() - oldStart.getTime();
    const row = await db.sessions.get(session.id); if (!row) return;
    await repo.save(db.sessions, {
      ...row,
      started_at: newStart.toISOString(),
      finished_at: row.finished_at ? new Date(new Date(row.finished_at).getTime() + deltaMs).toISOString() : null,
    });
    setEditing(false);
  };
  return <div className="date-row"><label className="form-label">Session date<input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} /></label><button className="button-primary" onClick={() => void shift()}>Move session</button><button className="button-secondary" onClick={() => setEditing(false)}>Cancel</button></div>;
}

function HistoryView(props: { exercises: Exercise[]; unit: "kg" | "lb" }) {
  const { exercises, unit } = props;
  const sessions = useLiveQuery(async () => (await db.sessions.orderBy("started_at").reverse().toArray()).filter(s => !s.deleted_at));
  const logs = useLiveQuery(() => db.exercise_logs.toArray());
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [viewExercise, setViewExercise] = useState<string | null>(null);
  const sessionLogs = useLiveQuery(async () => openSession ? db.exercise_logs.where("session_id").equals(openSession).filter(x => !x.deleted_at).sortBy("position") : [], [openSession]);
  const exLogs = useLiveQuery(async () => viewExercise ? db.exercise_logs.where("exercise_id").equals(viewExercise).filter(x => !x.deleted_at && x.status === "completed").toArray() : [], [viewExercise]);
  const [dataMode, setDataMode] = useState<"sessions" | "exercises">("sessions");
  const [deleteConfirm, setDeleteConfirm] = useState<import("./data/db").Session | null>(null);
  return <section>
    <div className="program-title-row"><div><p className="overline">TRAINING RECORD</p><h1>History</h1></div><div className="history-toggle"><button className={dataMode === "sessions" ? "activate-button selected" : "activate-button"} onClick={() => setDataMode("sessions")}>Sessions</button><button className={dataMode === "exercises" ? "activate-button selected" : "activate-button"} onClick={() => setDataMode("exercises")}>Exercises</button></div></div>
    {dataMode === "sessions" && (sessions ?? []).map(s => <article className="history-card" key={s.id}>
      <button className="history-head" onClick={() => setOpenSession(openSession === s.id ? null : s.id)}>
        <div><strong>{s.workout_name_snapshot}</strong><small>{new Date(s.started_at).toLocaleString()} · {s.status === "finished" ? `${Math.max(1, Math.round((new Date(s.finished_at ?? s.started_at).getTime() - new Date(s.started_at).getTime()) / 60000))} min · finished ${s.finished_at ? new Date(s.finished_at).toLocaleTimeString() : ""}` : "in progress"}{s.is_deload ? " · deload" : ""}{s.is_illness ? " · illness" : ""}</small></div>
        <span>{openSession === s.id ? "▾" : "▸"}</span>
      </button>
      {openSession === s.id && <div className="history-body">
        {(sessionLogs ?? []).map(log => { const ex = exercises.find(e => e.id === log.exercise_id); return <div className="history-log-row" key={log.id}><strong>{ex?.name ?? "?"}</strong><span>{log.status}{log.weight_entered != null ? ` · ${log.weight_entered} ${log.weight_unit} × ${log.miniset_reps.map(x => x ?? "–").join("/")}` : ""}{log.pain ? " · ⚠ pain" : ""}</span></div>; })}
        <div className="history-toggles"><label><input type="checkbox" checked={s.is_deload} onChange={e => { void db.sessions.get(s.id).then(row => { if (row) void repo.toggleSessionFlag(row, "is_deload", e.target.checked); }); }} /> Deload</label><label><input type="checkbox" checked={s.is_illness} onChange={e => { void db.sessions.get(s.id).then(row => { if (row) void repo.toggleSessionFlag(row, "is_illness", e.target.checked); }); }} /> Illness</label></div>
        <SessionDateEditor session={s} />
        <div className="date-row"><button className="button-secondary" onClick={() => setDeleteConfirm(s)}>Delete session</button></div>
      </div>}
    </article>)}
    {deleteConfirm && <div className="modal-backdrop" onClick={() => setDeleteConfirm(null)}><div className="modal-panel" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><p className="overline">DELETE SESSION</p><h2>Delete {deleteConfirm.workout_name_snapshot}?</h2></div><button className="close-button" onClick={()=>setDeleteConfirm(null)}>×</button></div><p className="lede">{deleteConfirm.started_at ? new Date(deleteConfirm.started_at).toLocaleDateString() : ""}, all weights and reps of this session will be permanently deleted. Your exercise history and programs stay untouched.</p><div className="modal-actions"><button className="button-secondary" onClick={()=>setDeleteConfirm(null)}>Keep it</button><button className="button-primary" onClick={() => { void repo.deleteSession(deleteConfirm.id); setOpenSession(null); setDeleteConfirm(null); }}>Delete session</button></div></div></div>}
    {dataMode === "exercises" && <div className="exercise-list">{exercises.map(ex => <article className="exercise-row" key={ex.id}>
      <div className="exercise-info"><h3>{ex.name}</h3><p>{muscleGroupName(ex.muscle_group)} · {(logs ?? []).filter(l => l.exercise_id === ex.id && l.status === "completed").length} sessions logged</p></div>
      <button className="row-action" onClick={() => setViewExercise(viewExercise === ex.id ? null : ex.id)}>{viewExercise === ex.id ? "▾" : "▸"}</button>
    </article>)}
    {viewExercise && (() => {
      return <div className="history-body">
        <ExerciseChart logs={exLogs ?? []} unitLabel={unit} displayUnit={unit} />
        {(exLogs ?? []).sort((a,b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")).map(log => <div className="history-log-row" key={log.id}><span>{log.completed_at ? new Date(log.completed_at).toLocaleDateString() : ""}</span><strong>{log.weight_entered} {log.weight_unit} × {log.miniset_reps.map(x => x ?? "–").join("/")}</strong>{log.pain ? <span>⚠</span> : null}</div>)}
        <div className="history-toggles"><button className="button-secondary" onClick={() => void repo.resetBaseline(viewExercise)}>Reset baseline</button><button className="button-secondary" onClick={() => void repo.updateExerciseRowPublic(viewExercise, { archived_at: new Date().toISOString() })}>Archive</button></div>
      </div>;
    })()}
    </div>}
    {!sessions?.length && dataMode === "sessions" && <div className="empty-state">No sessions yet.<br/><span>Finish a workout to build your history.</span></div>}
  </section>;
}

function SettingsView(props: { settings: { units: "kg" | "lb"; theme?: string; warmup_reminder_enabled?: boolean; hide_default_programs?: 0 | 1; hidden_default_program_ids?: string[]; local_backups?: boolean } | undefined | null; unit: "kg" | "lb"; setUnits: (u: "kg" | "lb") => void; authUser: string | null; serverAvailable: boolean; syncUrlConfigured: boolean; onLogout: () => void; onShowAuth: () => void }) {
  const { settings, unit, setUnits, authUser, serverAvailable, syncUrlConfigured, onLogout, onShowAuth } = props;
  const [busyExport, setBusyExport] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = "dark"; }, []);
  async function doExportJson() {
    setBusyExport(true);
    const bundle = await repo.exportAll();
    setCsvReport(await exportFile(`magnus-profectus-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), "application/json"));
    setBusyExport(false);
  }
  async function doExportCsv() {
    setBusyExport(true);
    const csv = await repo.exportLogsCsv();
    setCsvReport(await exportFile(`magnus-profectus-logs-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv"));
    setBusyExport(false);
  }
  async function doDownloadTemplate() {
    const csv = await repo.exportLogsCsv();
    const lines = csv.split("\n");
    const template = [lines[0], lines[1] ?? "2026-01-15,Workout A,Leg Press,60,kg,6,4,3,,,2,no,,no,no"].join("\n");
    const blob = new Blob([template], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "rp-tracker-import-template.csv"; a.click();
    URL.revokeObjectURL(url);
  }
  const [csvReport, setCsvReport] = useState<string | null>(null);
  const [localBackups, setLocalBackups] = useState(!!settings?.local_backups);
  const [backupReport, setBackupReport] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState(sync.getServerUrl());
  async function doImportCsv(file: File) {
    const text = await file.text();
    const result = await repo.importLogsCsv(text);
    setCsvReport(result.errors.length ? `Imported ${result.imported} rows, skipped ${result.skipped}. ${result.errors.slice(0, 3).join(" ")}` : `Imported ${result.imported} rows.`);
  }
  async function doImport(file: File) {
    const text = await file.text();
    try { const result = await repo.importAll(JSON.parse(text)); alert(`Imported ${result.merged} rows.`); } catch { alert("Import failed: invalid file."); }
  }
  function computeDiagnostics(): string {
    const vv = window.visualViewport;
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);visibility:hidden";
    document.body.appendChild(probe);
    const ps = getComputedStyle(probe);
    const out = `viewport ${window.innerWidth}x${window.innerHeight} | screen ${screen.width}x${screen.height} @${window.devicePixelRatio}x | visual ${vv ? Math.round(vv.width) + "x" + Math.round(vv.height) + " scale " + vv.scale.toFixed(2) + " offY " + Math.round(vv.offsetTop) : "n/a"} | insets T/B/L/R ${ps.paddingTop}/${ps.paddingBottom}/${ps.paddingLeft}/${ps.paddingRight} | dpr-pcss ${Math.round(window.innerWidth * window.devicePixelRatio)}`;
    probe.remove();
    return out;
  }
  const [diag, setDiag] = useState<string | null>(null);
  useEffect(() => { if (!diag) return; setDiag(computeDiagnostics()); }, [diag]);
  return <section>
    <p className="overline">PREFERENCES</p><h1>Settings</h1>
    <div className="settings-card"><strong>Units</strong><p>Weights are entered and displayed in this unit. History re-renders, nothing is rewritten.</p><div className="unit-switch"><button className={unit === "kg" ? "selected" : ""} onClick={() => setUnits("kg")}>Kilograms · kg</button><button className={unit === "lb" ? "selected" : ""} onClick={() => setUnits("lb")}>Pounds · lb</button></div></div>
    <div className="settings-card"><strong>Data</strong><p>Backup/restore all data (JSON), or your training log as a spreadsheet (CSV). CSV import accepts the same column shape, <button className="link-button" onClick={() => void doDownloadTemplate()}>download the template</button> to fill in past sessions.</p><div className="unit-switch"><button className="button-secondary" onClick={() => void doExportJson()} disabled={busyExport}>Export JSON</button><button className="button-secondary" onClick={() => void doExportCsv()} disabled={busyExport}>Export CSV</button><label className="button-secondary import-label">Import JSON<input type="file" accept="application/json" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) void doImport(f); }} /></label><label className="button-secondary import-label">Import CSV<input type="file" accept="text/csv" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) void doImportCsv(f); }} /></label></div>{csvReport && <p className="small-note">{csvReport}</p>}{localStorage.getItem("rp-schema-snapshot-note") && <p className="small-note">{localStorage.getItem("rp-schema-snapshot-note")}</p>}</div>
    {(authUser || (syncUrlConfigured && serverAvailable)) && <div className="settings-card"><strong>Account</strong><p>{authUser ? <>Logged in as <strong>{authUser}</strong>, data syncs to the server on every change and follows you to any device you log in from.</> : "Your sync server is configured and reachable. Log in or create an account to sync across devices."}</p>{authUser ? <div className="unit-switch"><button className="button-secondary" onClick={onLogout}>Log out</button></div> : <div className="unit-switch"><button className="button-secondary" onClick={onShowAuth}>Log in / Create account</button></div>}</div>}
    <div className="settings-card"><strong>Local backups</strong><p>After each finished workout, save a JSON snapshot of everything (programs, exercises, full history) as a file. On Android the file lands in the device Documents folder, where Nextcloud or Syncthing folder sync can pick it up. The ten newest backups are kept.</p><div className="unit-switch"><button className={localBackups ? "selected" : ""} onClick={() => { const next = !localBackups; setLocalBackups(next); void repo.patchSettings({ local_backups: next }); }}>After each workout</button><button className="button-secondary" onClick={() => void saveBackup().then(r => setBackupReport(r.location === "file" ? `Saved ${r.saved} in ${r.path ?? "the app Documents folder"}. ` : `Downloaded ${r.saved}.`)).catch(() => setBackupReport("Backup failed."))}>Save backup now</button></div>{backupReport && <p className="small-note">{backupReport}</p>}</div>
    <div className="settings-card"><strong>Sync server (optional)</strong><p>By default everything stays on this device. If you run your own sync server (see the project README), enter its address here and the app will reload using it. Leave the field empty to use the address the app itself is served from.</p><div style={{ display: "flex", gap: "8px" }}><input value={urlDraft} onChange={e => setUrlDraft(e.target.value)} placeholder="https://your-server.example" style={{ flex: "1 1 auto", minWidth: 0 }} /><button className="button-secondary" onClick={() => { sync.setServerUrl(urlDraft); window.location.reload(); }}>Save</button></div></div>
    <div className="settings-card"><strong>Warm-up reminder</strong><p>Before each exercise's first working set, the app asks "warm-up sets done?", helpful while learning the habit, noise once it's routine. This only turns off the reminder; per-exercise warm-ups are controlled in the exercise view.</p><div className="unit-switch"><button className={settings?.warmup_reminder_enabled !== false ? "selected" : ""} onClick={() => { void repo.patchSettings({ warmup_reminder_enabled: true }); window.location.reload(); }}>On</button><button className={settings?.warmup_reminder_enabled === false ? "selected" : ""} onClick={() => { void repo.patchSettings({ warmup_reminder_enabled: false }); window.location.reload(); }}>Off</button></div></div>
    <p>Read-only curated programs; clone one to make it yours. Hide removes programs from the Programs tab.</p><label className="clone-history-check"><input type="checkbox" ref={el => { if (el) el.indeterminate = settings?.hide_default_programs !== 1 && (settings?.hidden_default_program_ids?.length ?? 0) > 0; }} checked={settings?.hide_default_programs === 1} onChange={e => { if (e.target.checked) void repo.patchSettings({ hide_default_programs: 1 }); else void repo.patchSettings({ hide_default_programs: 0, hidden_default_program_ids: [] }); window.location.reload(); }} /> Hide all programs</label>
    <div className="settings-card"><strong>Training method</strong><p>{PROTOCOL_NAME} · 27-second rests · three partial sets per exercise</p></div>
    <div className="settings-card"><strong>Display diagnostics</strong><p className="small-note" style={{ wordBreak: "break-all" }}>{diag ?? <button className="button-secondary" onClick={() => setDiag("x")}>Show display info</button>}</p></div>
    <div className="settings-card"><strong>About</strong><p>{APP_NAME} {APP_VERSION} · data stored locally in this browser</p><p className="small-note">This app provides general training information, not medical advice. Consult a doctor before starting a demanding program. Training to failure carries risk; train at your own responsibility.</p></div>
  </section>;
}

/** "Extra" tab (user concept, 2026-09-30): team articles. Start page with intro +
 * team picks + popular list; sidebar of all articles; reader view with persistent
 * sidebar and back/home. Click counts tracked server-side for the popular list. */
function ExtraView(props: { slug: string | null; onOpen: (slug: string | null) => void }) {
  const openSlug = props.slug;
  const setOpenSlug = props.onOpen;
  const [listOpen, setListOpen] = useState(false);
  const [popular, setPopular] = useState<string[]>([]);
  useEffect(() => { void fetchPopular().then(setPopular); }, [openSlug]);
  const open = openSlug ? articleBySlug(openSlug) : undefined;
  return <section className="extra-view">
    {/* Desktop: persistent sidebar. Mobile (≤760px): sidebar hidden; "All articles" button
        + full-screen list instead: description first, then picks, then the button. */}
    <div className="extra-layout">
      <aside className="extra-sidebar">
        <span className="overline">ALL ARTICLES</span>
        <button className="extra-home" onClick={() => setOpenSlug(null)}>⌂ Extra home</button>
        <button className={`extra-side-link support-link${openSlug === "support" ? " selected" : ""}`} onClick={() => setOpenSlug("support")}>Support the project</button>
        {articles.map(a => <button key={a.slug} className={`extra-side-link${a.slug === openSlug ? " selected" : ""}`} onClick={() => setOpenSlug(a.slug)}>{a.title}<small>{a.date}</small></button>)}
      </aside>
      <div className="extra-content">
        {openSlug === "support" ? <SupportPage onHome={() => setOpenSlug(null)} /> : open ? <ArticleReader article={open} onHome={() => setOpenSlug(null)} onOpen={slug => { setOpenSlug(slug); window.scrollTo(0, 0); }} /> : <ExtraHome onOpen={slug => { setOpenSlug(slug); window.scrollTo(0, 0); }} popular={popular} onOpenAll={() => setListOpen(true)} />}
      </div>
    </div>
    {listOpen && <div className="modal-backdrop" onClick={() => setListOpen(false)}><div className="modal-panel article-list-panel" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><p className="overline">ALL ARTICLES · BY DATE</p><h2>{articles.length} articles</h2></div><button className="close-button" onClick={() => setListOpen(false)}>×</button></div><div className="article-list">{articles.map(a => <ArticleRow key={a.slug} article={a} onOpen={slug => { setListOpen(false); setOpenSlug(slug); window.scrollTo(0, 0); }} />)}</div></div></div>}
  </section>;
}

function ExtraHome(props: { onOpen: (slug: string) => void; popular: string[]; onOpenAll: () => void }) {
  const { onOpen, popular, onOpenAll } = props;
  const picks = teamPicks.map(articleBySlug).filter(Boolean) as NonNullable<ReturnType<typeof articleBySlug>>[];
  const popList = popular.map(articleBySlug).filter(Boolean) as NonNullable<ReturnType<typeof articleBySlug>>[];
  return <div className="extra-home-content">
    <p className="overline">FROM THE PROFECTUS TEAM</p>
    <h1>Extra information for those who seek it.</h1>
    <p className="lede">You don't need any of this. Everything required to run the program is in the Guide, and the app handles the rest. Ignore this tab entirely and you'll build muscle just the same. But if you want the ideas, the reasoning and the experience behind the method, the why under the instructions, this is where it lives.</p>
    <button className="button-primary all-articles-button" onClick={onOpenAll}>All articles ({articles.length})</button>
    <ArticleRow article={supportArticle} onOpen={onOpen} />
    <div className="extra-section"><span className="overline">TEAM RECOMMENDATIONS</span>{picks.map(a => <ArticleRow key={a.slug} article={a} onOpen={onOpen} />)}</div>
    {popList.length > 0 && <div className="extra-section"><span className="overline">MOST READ</span>{popList.map(a => <ArticleRow key={a.slug} article={a} onOpen={onOpen} />)}</div>}
  </div>;
}

const supportArticle = { slug: "support", title: "Support the project", blurb: "The app is free and stays free. Donations cover hosting and keep the lights on.", date: "2026-10-09", body: "" };

function SupportPage(props: { onHome: () => void }) {
  return <article className="article-reader">
    <button className="back-link" onClick={props.onHome}>‹ Extra home</button>
    <p className="overline">BY THE PROFECTUS TEAM</p>
    <h1>Support the project.</h1>
    <div className="article-body">
      <p>{APP_NAME} is free. Every feature, the whole guide, offline storage, sync to your own server. Your data stays yours and the code is open source, so nothing you rely on can ever be paywalled or taken away.</p>
      <p>If this app earned its place in your routine, you already know what the method delivers: steady, measurable progress toward a muscular, fit physique at a low bodyfat, no gimmicks and nothing hidden behind a paywall. Building, maintaining and improving the app takes real hours, and it will keep taking them as new features land. If you got value from it, a small donation is a direct way to say thank you for that value and the work behind it.</p>
      <p>One promise, stated plainly: donations unlock nothing, because nothing is locked. Paying or not paying changes no feature, no storage and no limit. It is purely a thank-you.</p>
      <p className="small-note">A future hosted sync service will be a separate paid option for those who want it. This page is not that.</p>
      {DONATION_URL
        ? <a className="button-primary support-donate" href={DONATION_URL} target="_blank" rel="noreferrer">Support {APP_NAME}</a>
        : <p className="small-note">Donation page coming shortly. The app itself needs nothing from you today.</p>}
    </div>
  </article>;
}

function ArticleReader(props: { article: NonNullable<ReturnType<typeof articleBySlug>>; onHome: () => void; onOpen: (slug: string) => void }) {
  const { article, onHome, onOpen } = props;
  useEffect(() => { void recordClick(article.slug); }, [article.slug]);
  const idx = articles.findIndex(a => a.slug === article.slug);
  const newer = idx > 0 ? articles[idx - 1] : undefined;
  const older = idx >= 0 && idx < articles.length - 1 ? articles[idx + 1] : undefined;
  return <article className="article-reader">
    <button className="back-link" onClick={onHome}>‹ Extra home</button>
    <p className="overline">{article.date} · BY THE PROFECTUS TEAM</p>
    <h1>{article.title}</h1>
    <div className="article-body">{renderMarkdownBody(article.body)}</div>
    <div className="article-nav">
      {older && <button className="button-secondary" onClick={() => onOpen(older.slug)}>‹ {older.title.slice(0, 30)}</button>}
      {newer && <button className="button-secondary" onClick={() => onOpen(newer.slug)}>{newer.title.slice(0, 30)} ›</button>}
    </div>
  </article>;
}

function ArticleRow(props: { article: NonNullable<ReturnType<typeof articleBySlug>>; onOpen: (slug: string) => void }) {
  const { article, onOpen } = props;
  return <button className="article-row" onClick={() => onOpen(article.slug)}>
    <strong>{article.title}</strong>
    <small>{article.blurb}</small>
    <span className="article-date">{article.date}</span>
  </button>;
}

function renderMarkdownBody(body: string) {
  return body.split("\n").map((line, i) => {
    if (line.startsWith("> ")) return <blockquote key={i}>{line.replace(/^>\s*/, "").replace(/\*\*/g, "")}</blockquote>;
    if (line.startsWith("#")) return <h2 key={i}>{line.replace(/^#+\s*/, "")}</h2>;
    if (/^- /.test(line)) return <p key={i} className="article-li">• {line.replace(/^- /, "").replace(/\*\*/g, "")}</p>;
    return line ? <p key={i}>{line.replace(/\*\*/g, "")}</p> : null;
  });
}

function Guide() {
  const [text, setText] = useState("");
  useEffect(() => { fetch("/GUIDE.md").then(r => r.ok ? r.text() : Promise.reject()).then(setText).catch(() => setText("Guide content will appear here.")); }, []);
  return <section className="guide-view"><p className="overline">FIELD GUIDE</p><h1>Train with intent.</h1><div className="guide-content">{(text || "Loading guide…").split("\n").map((line, i) => line.startsWith("#") ? <h2 key={i}>{line.replace(/^#+\s*/,"").replaceAll("{APP_NAME}", APP_NAME).replaceAll("{PROTOCOL_NAME}", PROTOCOL_NAME)}</h2> : line ? <p key={i}>{line.replace(/\*\*/g,"").replaceAll("{APP_NAME}", APP_NAME).replaceAll("{PROTOCOL_NAME}", PROTOCOL_NAME).replace(/^- /,"• ")}</p> : null)}</div></section>;
}

export default App;