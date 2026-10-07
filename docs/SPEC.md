# Rest-Pause Training Tracker — Build Specification (v1)

> **For the implementing agent:** this document is the single source of truth. Build it milestone by milestone (§17). Where something is ambiguous, choose the simplest option consistent with this spec and note the decision in `DECISIONS.md`. The domain logic in §6 is the core of the product: implement it as pure, fully unit-tested functions before any UI. The in-app guide text is supplied separately in `GUIDE.md`.

---

## 1. Product summary

A mobile-first, offline-first web app (PWA) for tracking a **rest-pause training protocol**. Later it will be wrapped as iOS and Android apps.

Each exercise is performed as **one working set** made of 3 mini-sets taken to failure at the **same weight**, with short rests between them. The app:

1. Logs each mini-set.
2. Computes a single progress metric per exercise per session (**capped load**).
3. Recommends next session's weight.
4. Flags stalled exercises that should be swapped.
5. Remembers pain flags.
6. Provides an independent rest timer.

Users own programs made of workouts (a "split", default 2 workouts), and workouts contain ordered exercises. Exercise history is shared across every workout that contains the exercise.

## 2. Naming and configuration (rename-safe)

The app name and the protocol name **must never be hard-coded**. They are not final.

`src/config/app.ts`:
```ts
export const APP_NAME = "Rest-Pause Tracker";   // placeholder, will change
export const APP_SHORT_NAME = "RP Tracker";     // PWA short_name
export const APP_SLUG = "rp-tracker";           // IndexedDB names, storage keys
export const PROTOCOL_NAME = "Rest-Pause Set";  // name of the working-set method, will change
```

- All user-facing strings live in `src/i18n/en.ts` (English only in v1; structure must allow more locales later). Strings reference the constants via interpolation, e.g. `t('guide.title', { PROTOCOL_NAME })`.
- The PWA manifest, `<title>`, and meta tags are generated from these constants at build time.
- `GUIDE.md` uses the tokens `{APP_NAME}` and `{PROTOCOL_NAME}`; replace them at render time.
- **Do not reference any third-party program names, authors, or trademarks** anywhere in code or UI.

## 3. Tech stack and architecture

| Concern | Choice |
|---|---|
| Framework | React 18 + TypeScript (strict) + Vite |
| Styling | Tailwind CSS |
| PWA | `vite-plugin-pwa` (Workbox); installable; app shell cached for offline use |
| Local store | IndexedDB via **Dexie** (+ `dexie-react-hooks` `useLiveQuery`) |
| Backend | **Supabase** (Postgres + Auth + Row Level Security), EU region, free tier |
| Routing | React Router |
| State | Dexie as source of truth for data; small Zustand store for UI/timer state |
| Charts | Recharts (lazy-loaded) |
| Drag-and-drop | `@dnd-kit` (touch-friendly) |
| Tests | Vitest for domain logic (mandatory); Playwright smoke test for the session flow (nice-to-have) |
| Hosting | Cloudflare Pages or Vercel (static) |
| Env vars | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (never ship a service key) |
| Later (v2) | Capacitor wrapper for iOS/Android (native vibration, local notifications, background timers) |

**Architecture principle: offline-first.**
- Every read and write goes to the local Dexie DB.
- A background sync engine (§12) reconciles with Supabase whenever online.
- The app must work fully offline once the user has signed in once on the device. Gyms often have no reception, and losing an entry is unacceptable.

Suggested structure:
```
src/
  config/app.ts
  i18n/en.ts
  domain/            # pure functions + tests (no React, no Dexie)
    units.ts  load.ts  progression.ts  recommend.ts  warmup.ts  rotation.ts  status.ts
    __tests__/
  data/
    db.ts            # Dexie schema, one DB per user: `${APP_SLUG}-${userId}`
    repos/           # CRUD per entity
    sync/            # push/pull engine
    library.ts       # built-in exercise library (static)
    templates.ts     # built-in program templates (static)
  features/
    auth/  programs/  session/  exercise/  history/  settings/  guide/
  components/
  timer/             # timer engine + audio + vibration + wake lock
content/GUIDE.md
supabase/migrations/*.sql
.github/workflows/backup.yml
```

## 4. Accounts and profiles

- **Auth:** email + password via Supabase Auth. Open sign-up with **email confirmation required**. Password reset by email. Change password and change email in Settings. **Delete account** in Settings (deletes all rows and the auth user; this will be required by the App Store later).
- **Password reset emails** go through a custom SMTP provider (e.g. Resend free tier) configured in Supabase. The built-in sender is for testing only.
- **Sessions persist indefinitely.** The user is never logged out automatically; rely on Supabase refresh tokens.
- **Profile switcher (multiple accounts per device):**
  - Keep a local registry of signed-in accounts: `{ userId, email, lastUsedAt }`.
  - Each account uses its own Supabase auth storage key (`sb-${APP_SLUG}-${userId}`) and its own Dexie database.
  - Switching swaps the active Supabase client and Dexie DB, with no re-login needed.
  - Setting **"Require password when switching profiles"** (default off) re-prompts for the password on switch.
  - "Sign out of this profile" removes it from the device registry and deletes that user's local DB (after confirming any unsynced data has been pushed; warn if not).
- **Isolation:** all tables are protected by RLS (`user_id = auth.uid()`). Local data is partitioned per user DB.
- **First sign-in requires connectivity.** After that, everything works offline.
- **Onboarding (first sign-in):**
  1. Accept the disclaimer (text in §11).
  2. Choose units (kg/lb).
  3. Pick a starting program template (§10).
  4. Link to the guide.
  5. On iOS Safari, show a one-time "Add to Home Screen" hint (installed PWAs get persistent storage and better timer behaviour).
  6. Call `navigator.storage.persist()`.

## 5. Data model

All tables (Supabase and Dexie mirror) share these columns:
- `id uuid` — client-generated v4
- `user_id uuid`
- `created_at timestamptz`
- `updated_at timestamptz` — set by the client on every write
- `deleted_at timestamptz null` — soft delete; the UI filters these out

Dexie rows additionally carry `_dirty: 0|1`.

Every table also has a **`protocol text default 'rest_pause'`** column where noted, so a second protocol can be added later without migration pain. Do not build any other protocol in v1.

### `user_settings` (one row per user, `id = user_id`)
| Field | Type | Default |
|---|---|---|
| units | 'kg' \| 'lb' | chosen at onboarding |
| theme | 'system' \| 'light' \| 'dark' | 'system' |
| active_program_id | uuid | template program |
| warmup_reminder_enabled | bool | true |
| warmup_scheme | jsonb `[{pct, reps}]` | `[{0.5,15},{0.75,10},{0.9,5}]` |
| default_rest_seconds | int | 27 |
| sound_enabled / sound_id / sound_volume | bool / text / 0–1 | true / 'beep' / 0.7 |
| get_ready_cue_enabled / get_ready_seconds | bool / int | true / 5 |
| vibration_enabled / vibration_ms | bool / int | true / 400 (Android only; see §8) |
| between_timer_enabled | bool | true |
| between_cue_ready_sec / between_cue_go_sec | int | 180 / 420 |
| workout_clock_visible | bool | true |
| wake_lock_enabled | bool | true |
| progression_window | int | 3 |
| gap_reset_weeks | int | 4 |
| require_password_on_switch | bool | false |
| disclaimer_accepted_at | timestamptz | — |

### `exercises` (user-owned; library items are **copied** in when added)
| Field | Notes |
|---|---|
| name | text, unique per user among non-deleted rows |
| muscle_group | enum, **required**: `chest, back, shoulders, traps, biceps, triceps, forearms, quads, hamstrings_glutes, calves, abs` |
| equipment | text[]: `barbell, dumbbell, machine, cable, bodyweight, bench, other` |
| library_key | text null |
| protocol | 'rest_pause' |
| setup_notes | text (seat height, grip, bar used…), shown every time |
| base_weight, base_weight_unit | numeric null, 'kg' \| 'lb' — optional (§6.2) |
| per_side | bool, default false — optional (§6.2) |
| unilateral | bool, default false (log weaker side; see §7.4) |
| increment, increment_unit | weight step **in the user's entry convention** (defaults §10) |
| miniset_count | int 1–5, default 3 |
| miniset_targets | jsonb `[[min,max],…]`, length = miniset_count, default `[[5,7],[3,5],[2,4]]` |
| total_target_min / total_target_max | int, default 12 / 15 |
| rest_seconds | int, default = settings.default_rest_seconds (27) |
| safety_flag | bool (barbell lifts to failure → "use safeties/spotter") |
| technique_confirmed_at | timestamptz |
| baseline_reset_at | timestamptz null (manual "reset baseline") |
| stagnation_dismissed_at | timestamptz null ("keep this exercise") |
| archived_at | timestamptz null (retired; history kept forever) |

### `programs`
`name`, `template_key text null`, `sort int`

### `workouts`
`program_id`, `name`, `position int`

### `workout_exercises`
`workout_id`, `exercise_id`, `position int`, `warmup_mode 'auto'|'on'|'off'` (default 'auto'), `replaced_at timestamptz null`

### `sessions`
| Field | Notes |
|---|---|
| program_id, workout_id | |
| workout_name_snapshot | text |
| protocol | 'rest_pause' |
| started_at, last_activity_at, finished_at | timestamptz |
| status | 'in_progress' \| 'finished' |
| is_deload, is_illness | bool (exclude the whole session from progression) |
| notes | text |

### `exercise_logs` (one per exercise per session)
| Field | Notes |
|---|---|
| session_id, exercise_id, position | |
| status | 'not_started' \| 'in_progress' \| 'completed' \| 'skipped' |
| weight_entered, weight_unit | as typed by the user |
| weight_kg | canonical |
| base_weight_kg_snapshot, per_side_snapshot | copied from the exercise at log time |
| targets_snapshot | jsonb `{ miniset_targets, total_min, total_max }` copied at log time |
| miniset_reps | int[] (length = miniset_count; nulls until entered) |
| rating | numeric null ∈ {1, 1.5, 2, 2.5, 3} |
| pain, pain_note | bool, text |
| warmup_confirmed | bool |
| completed_at | timestamptz (set when status → completed) |
| notes | text |

**Snapshots matter:** later edits to an exercise's base weight, per-side flag, or targets must never rewrite history.

**Derived values are computed, not stored** (§6): real load, capped load, eligibility, status, % change, stagnation count, recommendation. Editing any past log must simply re-derive.

## 6. Domain logic (pure functions, 100% unit-tested)

### 6.1 Units
- Store the entered value plus its unit, and `weight_kg` (1 lb = 0.45359237 kg).
- Display in the user's current unit. If the display unit equals the entered unit, show the entered value **exactly**. Otherwise convert and round to 0.5.
- Totals (load) display as integers.
- All comparisons and percentages are computed in kg.
- Switching units in Settings re-renders all history. Nothing is rewritten.
- Number formatting: max 1 decimal, strip trailing `.0`.

### 6.2 Load
Weight convention is the user's choice: whatever they type, used consistently per exercise (e.g. per dumbbell, total, or plates per side).

```
real_load_per_rep_kg = base_kg + weight_kg × (per_side ? 2 : 1)     // using the log's snapshots
total_reps           = sum(miniset_reps)
capped_reps          = min(total_reps, total_max)
capped_load          = real_load_per_rep_kg × capped_reps
```
- **Reps-only fallback:** if `real_load_per_rep_kg == 0` (e.g. bodyweight entered as 0 with no base), the metric is `capped_reps` and the UI labels it "reps" instead of kg/lb.
- With base weight blank and per-side off, this reduces exactly to "weight as entered × capped reps".

### 6.3 Eligibility and baselines
- A log is **eligible** if `status = completed` AND NOT `pain` AND NOT `session.is_deload` AND NOT `session.is_illness`.
- Consider only eligible logs of the same `exercise_id` (across all workouts and programs), ordered by `completed_at`.
- An eligible log is a **baseline** if ANY of:
  1. No earlier eligible log exists.
  2. The gap since the previous **completed** log (eligible or not) of this exercise is more than `gap_reset_weeks × 7` days.
  3. It is the first eligible log after `exercise.baseline_reset_at`.
- A baseline has status `baseline`. It is never counted as progress or non-progress.

### 6.4 Progress classification (for stagnation)
For an eligible, non-baseline log L:
- **Window** = the `progression_window` (default 3) eligible logs immediately before L, excluding any before the most recent baseline (the baseline itself is included).
- **prev** = the eligible log immediately before L.

L is **progress** if ANY of:
- **(a) New recent best:** `capped_load(L) > max(capped_load over window)`.
- **(b) Weight-up star:** `real_load_per_rep(L) > real_load_per_rep(prev)` AND `total_reps(L) ≥ total_min`. Status `progress_star` (unless (a) also holds → `progress`).
- **(c) More reps at this weight or heavier:** `capped_reps(L) > max(capped_reps of window logs with real_load_per_rep ≥ real_load_per_rep(L))`, where that subset is non-empty.

Otherwise status `no_progress`.

In reps-only mode, (a) compares capped reps and (b) never applies.

### 6.5 Stagnation counter and switch recommendation
- `stagnation_count` = number of **consecutive** `no_progress` eligible logs, counting back from the latest one.
- It resets to 0 on any `progress`/`progress_star`/`baseline` log.
- It counts only logs after `exercise.stagnation_dismissed_at`.
- Ineligible logs (pain, deload, illness, skipped) neither increment nor reset it.

UI states, shown on the exercise row and in the exercise view the next time the exercise is opened:
- **count = 1 → "Last chance"** (amber): "No progress last time. Beat your recent best today to keep this exercise."
- **count ≥ 2 → "Switch recommended"** (with a "Choose replacement" action, §7.6). Stays until the user switches, taps "Keep exercise" (sets `stagnation_dismissed_at = now`), or logs progress.

### 6.6 Session result colour (vs last session, shown after the set)
Compare against **prev** (the last eligible log). This is separate from stagnation.
- L is a baseline (first session, gap reset, or manual reset) → **Baseline** (neutral colour, no %, "Fresh start: this is your starting point"). This keeps returns from a break motivating rather than red.
- Weight-up star condition (6.4b) → **green + ★**, regardless of the load change.
- Else `capped_load > prev` → **green ↑**; equal → **amber =**; lower → **red ↓**.
- Show `% change = (capped_load − prev.capped_load) / prev.capped_load`, 1 decimal.
- Always pair colour with an icon and text (colour-blind safety).

### 6.7 Next-weight recommendation
Based on the last eligible log (if the most recent completed log was pain-excluded, still use the last eligible log, but the pain dialog in §7.4 takes precedence). Rules are evaluated in order:
1. `total_reps ≥ total_max` → **+1 increment** ("You hit the top of the range. Go heavier.")
2. `total_reps < total_min` OR `miniset_reps[0] < miniset_targets[0].min` → **−1 increment** ("Below target. Go lighter.")
3. In range AND `rating ≤ 1.5` → **+1 increment** ("Felt easy. Try heavier.")
4. Otherwise → **same weight** ("Right weight. Beat your reps.")

Increments are applied in the **entry convention** (`weight_entered ± increment`, converting if units differ), and the result is never below 0.
- The recommendation is **prefilled** in the weight input with the reason text, and is always editable.
- **No history:** no prefill; prompt "Pick a weight you can lift for about 7 good reps."

### 6.8 Warm-up calculation
Only applies when warm-ups are required for this exercise in this workout (§7.3).
```
working_real = base + weight × f         // f = 2 if per_side else 1
for each {pct, reps} in warmup_scheme:
  target_real = pct × working_real
  entry       = round_to_increment((target_real − base) / f)   // nearest multiple of increment; ties round down
  display     = entry > 0 ? `${entry} ${unit}${per_side ? ' per side' : ''} × ${reps}`
                          : `Base only (empty bar / bodyweight) × ${reps}`
```
- If `working_real == 0`, show reps only.
- If no working weight has been entered yet (and there is no recommendation), show the reps with "set weight first".
- Warm-ups are **recommendations only** and are never logged.

### 6.9 Workout rotation
- Workouts in the active program are ordered by `position`.
- Let `k` be the workout of the most recent **finished** session in this program. The start screen lists workouts beginning at `k+1` and wrapping (e.g. 3-split, last = 2 → order 3, 1, 2).
- With no history, use position order.

### 6.10 Workout totals
- **Workout load** = sum of `capped_load` for completed logs in the session (load-mode exercises only; reps-only exercises are listed separately).
- Compare with the previous finished session of the **same workout**: % and colour, as in 6.6 (no star).
- Also show **"X of Y exercises progressed"** (progress + progress_star, over eligible non-baseline logs). Label it as the primary indicator, since workout load shifts whenever exercises are swapped.

### 6.11 Required test cases (Vitest)
Exercise: base 0, per_side off, total 12–15, window 3, increment 2.5 kg, all logs eligible, consecutive weeks.

| # | Weight × reps | Total | Capped load | Status | Colour vs prev | Stagnation | Recommendation |
|---|---|---|---|---|---|---|---|
| S1 | 100 × 6/4/3 | 13 | 1300 | baseline | Baseline | 0 | 100 (rating 2) |
| S2 | 100 × 7/4/3 | 14 | 1400 | progress (a) | green ↑ +7.7% | 0 | 100 |
| S3 | 100 × 7/5/4 | 16 | 1500 (capped at 15) | progress (a) | green ↑ +7.1% | 0 | **102.5** (rule 1) |
| S4 | 102.5 × 6/4/3 | 13 | 1332.5 | progress_star (b) | green ★ (−11.2%) | 0 | 102.5 |
| S5 | 102.5 × 6/4/4 | 14 | 1435 | progress (c) | green ↑ +7.7% | 0 | 102.5 |
| S6 | 102.5 × 6/4/4 | 14 | 1435 | no_progress | amber = 0.0% | 1 → "Last chance" | 102.5 |
| S7 | 102.5 × 6/4/3 | 13 | 1332.5 | no_progress | red ↓ −7.1% | 2 → "Switch recommended" | 102.5 |
| S8 | 5 weeks later, 100 × 6/4/3 | 13 | 1300 | baseline (gap) | Baseline (neutral) | 0 | 100 |

Additional cases:
- Pain-flagged log: excluded from the window, stagnation, and prev. The pain dialog shows next time.
- Deload session: all its logs are excluded.
- A skipped log changes nothing.
- Manual baseline reset: the next eligible log is a baseline.
- "Keep exercise" dismissal resets the count.
- Reps-only mode (weight 0, base 0): uses capped reps. The star never applies.
- **Warm-ups:**
  - Barbell with base 20 kg, per side on, entry 40 (real 100 kg), increment 1.25 → 15 / 27.5 / 35 per side.
  - Dumbbell entry 30, increment 2 → targets 15 / 22.5 / 27 → **14 / 22 / 26** (nearest; ties down).
  - Bodyweight: base 80, entry 10 → all three show "Base only".
- **Units:** 20 kg displayed in lb → 44 (44.09 rounded to 0.5 → 44). 45 lb entered, display lb → exactly 45.
- **Rotation:** 3 workouts, last finished = 2 → order [3, 1, 2]. No history → [1, 2, 3].
- Capping: 18 total reps with a 12–15 target → capped_reps 15, plus an "above range" message.

## 7. Screens and flows

### 7.1 Navigation
Bottom tab bar on phone, side rail on tablet/desktop:
- **Train** (start/resume)
- **Programs**
- **History**
- **Guide**
- **Settings**

A profile switcher sits in the header menu. A subtle sync-status icon shows synced / pending / offline.

### 7.2 Train → start screen
- If a session is `in_progress`: show a prominent "Resume [workout] (started 14:02)" card with Resume / Finish now.
- Stale sessions: on app load, any `in_progress` session with `last_activity_at` older than 3 h is auto-finished with `finished_at = last_activity_at`.
- Otherwise list the active program's workouts in rotation order (§6.9). The first is highlighted as **Next**. Each shows its last-performed date and exercise count.
- Tapping a workout creates the session and a `not_started` log for each non-replaced `workout_exercise`, in position order.
- Optional toggles at start: **Deload session**, **Feeling ill**, each with an info icon ("Logged normally but won't count toward progress or stagnation").

### 7.3 Session screen (exercise list)
- **Header:** workout name, small count-up workout clock (starts when the session starts; hideable in settings; never modal), between-exercise timer chip when active (§8.2), **Finish workout** button.
- **One row per exercise:**
  - Name.
  - Status indicator: **grey** not started, **amber** in progress, **green ✓** completed, **grey strikethrough** skipped (always icon + colour).
  - Last result summary (e.g. "Last: 102.5 × 6/4/3").
  - Badges: **PAIN** (prominent, distinct from regression red, e.g. filled magenta/red pill with a ⚠ icon), **Last chance**, **Switch recommended**, **New**, **Warm-up**.
- **Reorder:** drag handle (dnd-kit) plus accessible up/down buttons. The new order is saved to `workout_exercises.position` for future sessions.
- **Row menu:** Skip today, Swap exercise (§7.6), Edit exercise settings, Remove from workout.
- **"Add exercise" button:** adds to this session, and optionally to the workout permanently (checkbox, default on).
- **Warm-up requirement (`warmup_mode = auto`):** the first exercise of each `muscle_group` in the workout's current order gets warm-ups; later same-group exercises don't. Recompute on reorder. `on`/`off` override it.
- **Layout:** on phone, tapping a row opens the exercise view full-screen. On tablet/desktop, the list and exercise view sit side by side (two-pane).

### 7.4 Exercise view (the core screen)
Top to bottom:

1. **Header:** workout name (small), exercise name, setup notes (tap to edit), safety banner if `safety_flag` ("Use safety arms or a spotter when training to failure"), unilateral note if applicable ("Log the reps of your weaker side. Start the timer after both sides").
2. **Pain gate (modal on open):**
   - Trigger: the most recent completed log of this exercise has `pain = true`.
   - Content: "Last time you flagged pain[: note]. Take it carefully today."
   - Actions: **Continue with caution** / **Swap exercise** / **Skip today**.
   - Must be answered before inputs are enabled.
3. **Stagnation banner** (if any, §6.5).
4. **Last time card:**
   - Date.
   - Weight and mini-set reps.
   - Capped load.
   - Its % change vs the session before it (if any).
   - Its rating.
   - Pain flag if set.
   - If no history: "First time: pick a weight you can lift for about 7 good reps."
5. **Warm-ups** (only if required): three rows from §6.8, e.g. "15 kg per side × 15". Not tracked.
6. **Working weight input** (single field):
   - Prefilled with the recommendation plus reason text (§6.7). Numeric keypad (`inputmode="decimal"`) with ± increment steppers.
   - Info icon: "Keep the same weight for all mini-sets. If it's too heavy or light, change it next session. The app will suggest how."
   - **Warm-up confirmation:** on first focus of this field for a warm-up exercise (if the setting is on and not yet confirmed for this log), show a popup: "Warm-up sets done?" [OK], with a small note: "You can turn this reminder off in Settings." Set `warmup_confirmed = true`.
7. **Mini-set inputs** (N = miniset_count). Each row has:
   - A large reps field (`inputmode="numeric"`, ± steppers).
   - The target range ("target 5–7").
   - The previous hint: "last: 6" = reps achieved in this mini-set last time.
   - **If the entered weight differs from the last eligible log's weight**, replace every "last: n" hint with "★ new weight" and show only the target range.
8. **Rest timer** (§8.1): a large floating/sticky button, always visible in this view, fully independent of the inputs.
9. **Pain toggle** plus an optional note field (appears when the toggle is on).
10. **Rating selector:**
    - Segmented control: 1, 1.5, 2, 2.5, 3.
    - Labels under 1 / 2 / 3: "Easy – go heavier" / "Right weight" / "Too heavy – go lighter".
    - Optional.
11. **Result panel:**
    - Updates live as reps are entered.
    - Final once all mini-sets are filled.
    - Contents: total reps, capped load (or reps), and the colour/icon/% from §6.6.
    - Messages:
      - Above range: "Above target: reps past {max} don't count. Go heavier next time."
      - Below range: "Below target: go lighter next time."
12. **Chart** (§7.5).
13. **Done** button. Status becomes `completed` when weight and all mini-set reps are filled; otherwise the log stays `in_progress`. Exiting via Done or back **right after** the log became completed starts the between-exercise timer (§8.2).

- Every field autosaves on change (debounced ≤ 300 ms) and updates `session.last_activity_at`.
- Past logs can be edited from History with the same component.

### 7.5 Exercise chart
- **X-axis:** session number for this exercise (1…n), **not dates**. **Y-axis:** capped load (or reps in reps-only mode).
- Shows the last 10 sessions by default; an **Expand** button shows the full history (horizontal scroll or zoom).
- **Markers:**
  - weight change (★ marker)
  - pain (⚠, hollow)
  - deload/illness (hollow)
  - baseline (vertical dashed line)
- **Tooltip:** date, weight, mini-set reps, status.
- History spans the exercise across all workouts and programs.

### 7.6 Swap / replace exercise
- **Triggers:** "Switch recommended", the pain gate, or the row menu.
- **Suggestions:** library and user exercises with the same `muscle_group` that are not already in the workout, plus "Create custom".
- **Effect:**
  - The old `workout_exercise` gets `replaced_at = now`.
  - A new `workout_exercise` is inserted at the same position.
  - The current session's log is swapped (if not started).
  - Old exercise history is kept. Offer "Archive old exercise" (default off, since it may be used elsewhere).
- New exercises trigger the technique reminder (§11).

### 7.7 Finish workout
- **Summary:** duration, workout load and % vs the last session of the same workout, "X of Y exercises progressed", and a per-exercise list with status icons.
- Deload/illness toggles are still editable here.
- Exercises never completed stay `not_started`/`in_progress` and are ignored by progression.
- Sets `finished_at` and releases the wake lock.

### 7.8 Programs
- List of programs; one is **active** (radio).
- Create from a template (§10) or blank. Rename, duplicate, delete (soft).
- **Program editor:**
  - Workouts (add/rename/reorder/remove; default 2).
  - Within each workout, exercises (add from library or custom, reorder, remove, warm-up mode).
- **Exercise editor:**
  - Name.
  - **Muscle group (required picker).**
  - Equipment.
  - Setup notes.
  - Base weight (optional, info icon with the example from the guide).
  - Per side (optional, info icon).
  - Unilateral.
  - Increment.
  - Mini-set count and per-mini-set target ranges.
  - Total target range.
  - Rest seconds.
  - Safety flag.
  - Validation: ranges ascend, min ≤ max, count 1–5, rest 5–120 s.
- **Adding a new exercise** (custom, or first time a library item is copied in) shows the technique reminder (§11) before saving. Store `technique_confirmed_at`.

### 7.9 History
- **Sessions list** (newest first). Tap to view and edit logs, toggle deload/illness, delete the session.
- **Exercises list:** per-exercise history table plus the full chart, a **Reset baseline** action, and archive/unarchive.

### 7.10 Guide
Renders `content/GUIDE.md` with tokens replaced. Info icons elsewhere may deep-link to guide sections by anchor.

## 8. Timers (technical requirements)

### 8.1 Rest-pause timer
- **Fully independent** of inputs.
- Duration = the exercise's `rest_seconds` (default 27).
- **Tap** = start. **Tap while running** = restart from full (covers interrupted sets). **Long-press** (or a small ✕) = stop.
- A large countdown is shown on the button and optionally as a full-width bar.
- **Timestamp-based:** store `endsAt` in the Zustand store and persist it (survives reload). Remaining time = `endsAt − now`. Render with `requestAnimationFrame` or a 250 ms interval. **Never** count interval ticks.
- **Cues:**
  - An optional get-ready cue at T−`get_ready_seconds` (short, soft).
  - An end cue at 0 (distinct, louder).
  - Sound options: 3–4 synthesized sounds (beep, double beep, chime, bell).
  - Volume: low / medium / high / custom slider.
- **Audio:**
  - Synthesize with the Web Audio API (no audio files needed).
  - Unlock/resume the `AudioContext` on the first user tap in each session (iOS requirement).
  - When the timer starts, **pre-schedule** the cue oscillators at `audioCtx.currentTime + offset`. This is more robust than `setTimeout` when JS is throttled.
- **Vibration:**
  - `navigator.vibrate(vibration_ms)` at end (plus a short pulse at get-ready), feature-detected.
  - Where unsupported (all iOS browsers), hide the vibration settings and show: "Vibration isn't supported by this browser. It will be available in the mobile app."
- **Wake lock:**
  - Request `navigator.wakeLock.request('screen')` while a session is in progress (setting, default on).
  - Re-acquire on `visibilitychange → visible`. Release on finish.
- **Web limitation (document in-app):** if the screen locks or the app is backgrounded, cues may not fire. On return, show "Rest ended X s ago." The native wrapper (v2) fixes this with local notifications.

### 8.2 Between-exercise timer
- **Count-up.** Starts automatically only when leaving an exercise that has **just** become completed.
- Shown as a small header chip on the session screen.
- Soft cue at `between_cue_ready_sec` (3:00, "Ready"). Stronger cue at `between_cue_go_sec` (7:00, "Go").
- Stops when the user starts any rest-pause timer, enters a rep, or taps the chip to dismiss.
- Setting to disable it.

### 8.3 Workout clock
- Small count-up in the session header from `started_at`. Non-interactive and never intrusive. Hideable.
- Subtle colour shift after 60 minutes (no alert).

## 9. Settings
- **Profile:** email, change password, change email, sign out of this profile, delete account.
- **Units:** kg / lb (re-renders all history).
- **Theme:** system / light / dark.
- **Warm-ups:** reminder popup on/off; scheme (3 rows of % and reps).
- **Rest timer:** default seconds (27); sound on/off, choice, volume, test button; get-ready cue on/off and seconds; vibration on/off and duration (short 200 / medium 400 / long 800 ms; hidden if unsupported); keep screen awake.
- **Between-exercise timer:** on/off, ready and go thresholds.
- **Workout clock:** visible on/off.
- **Progression:** window (sessions, default 3, range 2–6); gap reset (weeks, default 4, range 2–12). Each has an info icon.
- **Profiles:** require password when switching.
- **Data:** export JSON (all tables), export CSV (flattened exercise logs), import JSON (merge by `id`, newer `updated_at` wins), last sync time, "Sync now".
- **About:** app name/version, disclaimer, guide link.

## 10. Built-in exercise library and program templates

### 10.1 Default increments (by primary equipment, set at copy time in the user's unit)
| Equipment | kg | lb |
|---|---|---|
| Barbell | 2.5 | 5 |
| Dumbbell | 2 | 5 |
| Machine | 5 | 10 |
| Cable | 2.5 | 5 |
| Bodyweight (added load) | 2.5 | 5 |

Library items ship with `base_weight = null` and `per_side = false`. Users set these themselves; bodyweight items show a tip: "Tip: set base weight to your bodyweight."

### 10.2 Library (`src/data/library.ts`)
S = `safety_flag`, U = `unilateral`. Keys are kebab-case names.

| Muscle group | Exercises |
|---|---|
| Chest | Barbell Bench Press (S), Incline Barbell Bench Press (S), Smith Machine Bench Press (S), Dumbbell Bench Press, Incline Dumbbell Press, Decline Dumbbell Press, Machine Chest Press, Incline Machine Press, Pec Deck, Dumbbell Fly |
| Back | Lat Pulldown, Close-Grip Lat Pulldown, Seated Cable Row, One-Arm Dumbbell Row (U), Chest-Supported Dumbbell Row, Machine Row, T-Bar Row, Barbell Row (S), Pull-Up (bodyweight), Dumbbell Pullover |
| Shoulders | Seated Dumbbell Shoulder Press, Machine Shoulder Press, Standing Barbell Overhead Press (S), Arnold Press, Dumbbell Lateral Raise, Cable Lateral Raise, Reverse Pec Deck, Bent-Over Dumbbell Rear Delt Raise |
| Traps | Dumbbell Shrug, Barbell Shrug |
| Biceps | Barbell Curl, EZ-Bar Curl, Incline Dumbbell Curl, Dumbbell Hammer Curl, Cable Curl, Preacher Curl |
| Triceps | EZ-Bar Skull Crusher (S), Close-Grip Bench Press (S), Cable Triceps Pushdown, Overhead Cable Triceps Extension, Overhead Dumbbell Triceps Extension, Dip (bodyweight), Machine Dip |
| Quads | Leg Press, Hack Squat, Barbell Back Squat (S), Smith Machine Squat (S), Goblet Squat, Bulgarian Split Squat (U), Leg Extension |
| Hamstrings & glutes | Romanian Deadlift (S), Dumbbell Romanian Deadlift, Seated Leg Curl, Lying Leg Curl, Hip Thrust (S), Back Extension (bodyweight) |
| Calves | Standing Calf Raise, Seated Calf Raise, Leg Press Calf Raise, Single-Leg Dumbbell Calf Raise (U) |
| Forearms | Dumbbell Wrist Curl, Dumbbell Reverse Wrist Curl |
| Abs | Cable Crunch, Machine Crunch, Weighted Decline Sit-Up, Hanging Knee Raise (bodyweight) |

### 10.3 Templates (`src/data/templates.ts`)
**Gym 2-Split (default)**: two exercises per muscle group; warm-ups auto (the first of each group).
- **Workout A:** Leg Press, Hack Squat · Romanian Deadlift, Seated Leg Curl · Barbell Bench Press, Incline Dumbbell Press · Incline Dumbbell Curl, Cable Curl
- **Workout B:** Lat Pulldown, One-Arm Dumbbell Row · Seated Dumbbell Shoulder Press, Machine Shoulder Press · EZ-Bar Skull Crusher, Cable Triceps Pushdown · Standing Calf Raise, Seated Calf Raise

**Dumbbell & Bench 2-Split:** placeholder. The owner will supply the content. Implement the template structure and hide it from the UI behind `TEMPLATE_DB_BENCH_ENABLED = false` until the content exists.

## 11. Key microcopy (put in `en.ts`)
- **Technique reminder (adding a new exercise):**
  - Title: "Before you add {exercise}"
  - Body: "Every set in this program goes to failure, so good technique matters more than usual. If you're not fully confident with this movement, review it with a coach or a good tutorial first."
  - Buttons: [Find tutorials] (opens `https://www.youtube.com/results?search_query={exercise}+technique`) · [I'm confident, add it]
- **Warm-up confirmation:** "Warm-up sets done?" [OK] — small print: "You can turn this reminder off in Settings."
- **Weight info:** "Use the same weight for all mini-sets. If it feels off, change it next session. We'll suggest how."
- **Base weight info:**
  - "Optional. Weight that's there before you add any: the bar, a machine sled, or your bodyweight for bodyweight exercises. It makes warm-up suggestions accurate."
  - Example: "20 kg bar with 20 kg per side → enter 20, base 20, per side on."
- **Per side info:** "Turn on if you enter the weight added to each side of the bar."
- **First time:** "First time with this exercise: pick a weight you can lift for about 7 good reps."
- **Pain gate:** "Last time you flagged pain{: note}. Take it carefully today." [Continue with caution] [Swap exercise] [Skip today]
- **Last chance:** "No progress last time. Beat your recent best today to keep this exercise."
- **Switch recommended:** "Two sessions without progress. This exercise has done its job. Time to switch." [Choose replacement] [Keep exercise]
- **Star:** "★ Heavier weight and reps in range. That's progress."
- **Baseline:** "Fresh start: this is your starting point."
- **Above range:** "Above target: reps past {max} don't count. Go heavier next time."
- **Below range:** "Below target: go lighter next time."
- **Deload / illness info:** "This session is logged but won't count toward progress or stagnation."
- **Unilateral:** "Log the reps of your weaker side. Start the timer after both sides."
- **Disclaimer (onboarding and About):** "This app provides general training information, not medical advice. Consult a doctor before starting a demanding program, especially with an injury or health condition. Training to failure carries risk; train at your own responsibility." [I understand]
- **iOS install hint:** "For the best experience, add this app to your Home Screen: tap Share → Add to Home Screen."

## 12. Sync engine
- **Local:** one Dexie DB per user (`${APP_SLUG}-${userId}`), with tables mirroring §5 plus `_dirty`, and a `meta` table holding `lastPulledAt` per table.
- **Writes:** every mutation sets `updated_at = now()` (client ISO) and `_dirty = 1`.
- **Push:**
  - Upsert dirty rows in FK order: `user_settings → programs → workouts → exercises → workout_exercises → sessions → exercise_logs`.
  - Batch ≤ 500 rows.
  - On success, clear `_dirty` only if the row's `updated_at` hasn't changed since the push began.
- **Pull:**
  - Per table, `select * where updated_at > lastPulledAt order by updated_at`, paginated.
  - Merge with **last-write-wins** by `updated_at`: a local dirty row newer than the remote copy is kept.
- **Triggers:** app start, `online` event, every 60 s while online with dirty rows, workout finish, `visibilitychange → hidden` (best effort), and manual "Sync now".
- **Deletes are soft** (`deleted_at`). Purge rows soft-deleted more than 90 days ago (server job, optional).
- **Status icon:** synced / pending (n) / offline / error (tap for detail).
- LWW per row is acceptable. Single-user, near-simultaneous edits on two devices are rare.

## 13. Supabase setup and backups
- **Migrations** in `supabase/migrations/`. For each table, enable RLS and add:
  ```sql
  alter table public.exercises enable row level security;
  create policy "own rows" on public.exercises
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  ```
  Index `(user_id, updated_at)` on every table; `(user_id, exercise_id, completed_at)` on `exercise_logs`.
- **Delete account:** a Supabase Edge Function (service role) deletes the user's rows and the auth user.
- **Auth settings:** email confirmation on; custom SMTP (Resend) for confirmation and reset emails; site URL and redirect URLs for the deployed domain.
- **Free-tier notes:** projects pause after 7 days without API requests, and there are no backups. Both are handled by the workflow below.
- **`.github/workflows/backup.yml`** (daily cron):
  1. `curl` a lightweight REST endpoint with the anon key (keeps the project active).
  2. `pg_dump` via the **session pooler** connection string (IPv4-compatible), stored as the secret `SUPABASE_DB_URL`.
  3. Gzip and encrypt with `age` or `gpg` (secret key).
  4. Upload as a workflow artifact (retention 30 days) and/or to private object storage.

  Document restore steps in `README.md`.

## 14. UI, responsiveness and accessibility
- **Context:** used mid-set, sweaty, often one-handed, sometimes in bright or dim light.
  - Prioritise glanceable, very large numerals (tabular figures) for timer, weight and reps.
  - Tap targets ≥ 48 px.
  - High contrast.
  - Dark theme that looks deliberate, not an inverted light theme.
- **Breakpoints:**
  - Phone (< 640 px): single column, exercise view full-screen, bottom tabs.
  - Tablet (640–1024): two-pane session.
  - Desktop (> 1024): two-pane with side rail, max content width.
- **Colour semantics are reserved:** green = progress, amber = same/in progress, red = regression, a distinct hue for PAIN, neutral for baseline and not-started. Never use these colours decoratively. Always pair colour with icon and text.
- **Visual identity:** give it a distinct, sport-specific identity. Avoid a generic SaaS look (identical rounded cards with soft grey shadows, gradient washes, all-caps eyebrow labels). Use a restrained palette and one or two deliberate typefaces with a clear numeric style.
- **Keyboard:** numeric keypads (`inputmode`); Enter moves to the next mini-set field.
- **Accessibility:** WCAG AA contrast, visible focus states, `aria-live="polite"` announcements for the timer end and result.
- **Motion:** respect `prefers-reduced-motion`.

## 15. Non-functional requirements
- **Offline:** full functionality offline after first sign-in; no data loss on crash, reload or connectivity loss (autosave per field).
- **Performance:** interactive in under 2 s on a mid-range phone; session screens are not blocked by sync.
- **Privacy:** store only what the app needs. No third-party analytics or trackers in v1.
- **Code quality:** TypeScript strict, ESLint + Prettier. Domain logic has 100% branch coverage of the §6 rules.
- **Browser support:** latest 2 versions of Safari (iOS/macOS), Chrome (Android/desktop), Firefox, Edge.

## 16. Out of scope for v1
Native iOS/Android builds (v2, via Capacitor), push notifications, other training protocols (e.g. giant sets), social/sharing, additional languages, health-platform integrations, coach/client roles, payments.

## 17. Milestones and acceptance criteria
1. **Scaffold and domain.** Vite/React/TS/Tailwind/PWA scaffold, config constants, i18n. All §6 functions implemented with the §6.11 tests passing.
2. **Local data.** Dexie schema, repositories, library, Gym 2-Split template, program/workout/exercise editors, technique reminder. *Accept:* create a program offline and edit, reorder and persist exercises.
3. **Training flow.** Start screen with rotation, session screen, exercise view (all of §7.4), chart, finish summary, history editing. *Accept:* run the §6.11 S1–S8 sequence through the UI and see the exact statuses, colours, badges and recommendations.
4. **Timers.** Rest-pause timer, between-exercise timer, workout clock, audio, vibration, wake lock. *Accept:* the timer restarts on tap, stops on long-press, stays accurate after 60 s in a background tab (shows "ended X s ago"), and cues fire with the screen on (iOS Safari and Android Chrome).
5. **Accounts and sync.** Supabase auth, email confirmation, password reset, profile switcher, RLS migrations, sync engine, status icon. *Accept:* log a session offline on device A, reconnect, and see it on device B. User X cannot read user Y's rows (test RLS).
6. **Settings, data, guide.** All §9 settings including unit switching of history, export/import, guide rendering with tokens, onboarding, disclaimer, iOS install hint.
7. **Ops.** Backup workflow, deployment, README (setup, env vars, restore).

## 18. Open items (owner to supply later)
- Final app name and protocol name (change §2 constants only).
- Dumbbell & Bench 2-Split template content.
- Final review of the `GUIDE.md` text.
- App icon and branding assets (use a simple placeholder icon generated from the app name's initials).
- Production domain and SMTP provider account.
