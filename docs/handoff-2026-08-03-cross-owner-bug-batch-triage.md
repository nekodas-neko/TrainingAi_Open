# Handoff — 2026-08-03 · Owner bug/feature batch: triage and scoping (Q-63 … Q-69)

_Domain: `cross` (touches `workouts`, `cardio`, `devices`, `platform`, `body`) · Branch:
`claude/workout-next-confirmation-rkrs1u` · PR: none opened yet — docs-only, ready to open_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/<pillar>/README.md` for whichever pillar you're working in, then
> `docs/implementation-backlog.md` (the queue — these are **Q-63 … Q-69**). This file covers only
> what *this* session did and what it leaves behind.

## Goal

The owner walked through a batch of screenshots and one feature idea, one at a time, across a
single ongoing session, and asked for each to be scoped into a plan and queued — explicitly **not**
implemented yet ("don't need to merge till we say complete"). Session ended with "add it to the
backlog and close this session." **This was a planning session (PR 1 of the two-PR backlog
protocol) — no fixes were implemented, no source code was touched.**

## Current status

- **Build/test:** docs-only change (7 plan docs + backlog entries + this handoff); no source
  touched, nothing to build or test.
- **Device-verified:** N/A — nothing was implemented. Several of the queued items carry a hard
  device gate once built (Q-64 needs a new APK + on-device mic test; Q-67 needs a new APK; Q-68's
  actual repro is BLE-ring-gated and inert in the sandbox).
- **Nothing in this batch is claimed as fixed.** All seven items are still live/open.
- **Not yet committed to the branch as of this handoff being written** — the branch already has 6
  prior commits from this session (Q-63 through Q-68's plans/backlog entries, pushed incrementally
  as each was scoped); this handoff + the Q-69 plan + doc cleanup are the final commit before the
  session closes.

## What shipped (docs only)

| Item | Plan doc | One-line |
|---|---|---|
| Q-63 `[workouts]` | [`2026-08-02-workout-skip-exercise-confirmation.md`](superpowers/plans/2026-08-02-workout-skip-exercise-confirmation.md) | Skip button advances to the next exercise with zero confirmation in a normal (non-solo) workout |
| Q-64 `[workouts][devices]` | [`2026-08-02-voice-logging-android-native-stt.md`](superpowers/plans/2026-08-02-voice-logging-android-native-stt.md) | Voice-log button dies instantly on the APK — missing `RECORD_AUDIO` + WebView can't really do STT anyway |
| Q-65 `[workouts]` | [`2026-08-02-pip-summary-screen-missing-rest-countdown.md`](superpowers/plans/2026-08-02-pip-summary-screen-missing-rest-countdown.md) | PiP shows a static placeholder instead of the live rest countdown on the exercise-summary screen |
| Q-66 `[cardio]` | [`2026-08-02-guided-walk-treadmill-mode.md`](superpowers/plans/2026-08-02-guided-walk-treadmill-mode.md) | Guided walk has no treadmill/no-GPS mode; indoor GPS noise would otherwise pollute pace/distance stats |
| Q-67 `[platform]` | [`2026-08-03-scale-listening-notification-quieted.md`](superpowers/plans/2026-08-03-scale-listening-notification-quieted.md) | Persistent "Scale connected — listening" notification is unwanted noise |
| Q-68 `[cardio][devices]` | [`2026-08-03-auto-activity-detection-false-positive-gate.md`](superpowers/plans/2026-08-03-auto-activity-detection-false-positive-gate.md) | Auto walk/run detection still false-positives — the ring-confirm path skips the distance/elapsed notify gate the sensor-fallback path already has |
| Q-69 `[body]` | [`2026-08-03-scale-lowest-reading-trend.md`](superpowers/plans/2026-08-03-scale-lowest-reading-trend.md) | Scale weight trend should use the day's lowest confirmed reading, not the first (fixes a clothed-first-weighin locking in a bad trend value) |

All seven are inserted into `docs/implementation-backlog.md`'s Queue, immediately above Q-51, each
with its own branch name, plan link, and rationale. Renumbered twice during reconciliation with two
other parallel sessions that had claimed overlapping numbers (original 52…58 → briefly 57…62 →
final 63…69). Q-70 is the next free Q number.

## The seven diagnoses (all traced to source — do not re-derive these)

1. **Q-63.** `components/workout/active-workout-screen.tsx:518-520` (pre-set screen) calls
   `onClick={onSkip}` directly with no gate at all; `:699-701` (active/rest bar) only routes through
   the existing `withConfirm`/`ConfirmDialog` machinery when `soloMode` is true. `onSkip` is
   `advance()` in `components/workout-screen.tsx`, which discards in-progress set/rest state and
   moves to the next exercise (or ends the workout). Fix: route both call sites through an
   unconditional confirm.
2. **Q-64.** Two stacked causes, confirmed by grep — `android/.../AndroidManifest.xml` has **no**
   `RECORD_AUDIO` permission at all, so Capacitor's own `BridgeWebChromeClient.onPermissionRequest()`
   grant flow silently fails and `rec.onerror` fires the instant `VoiceLogButton`
   (`components/workout/set-card.tsx`) calls `.start()`; and even with the permission declared,
   embedded Android WebView (unlike Chrome) doesn't reliably implement real STT — `voice logging`
   is still listed as an unplanned Batch O item in `docs/planned_upgrades.md` for exactly this
   reason. Real fix needs a native Android speech-recognition plugin, not a manifest tweak alone.
3. **Q-65.** `components/workout-screen.tsx:1696-1705` — the PiP branch for `mode ===
   "exercise-summary"` is a static `<div>` placeholder that never reads `lastSetRestStartMs`/
   `lastSetRestSec`, unlike the non-PiP `LastSetRestTimer` (which shows a live ring) and unlike the
   `mode === "active"` PiP branch right below it (which already uses `PipView` correctly for this).
   Fix: route the summary-mode PiP branch through `PipView` too, configured as an "all sets done,
   resting" state.
4. **Q-66.** Guided walk (`components/guided-walk/`) never got the treadmill/no-GPS treatment the
   manual "Other activity" logging flow already has (`activity_types.treadmill` with
   `is_distance_based=false`, GPS skipped via `isDistanceBased` in
   `components/activity/active-activity-screen.tsx:40`). Fix ports that exact pattern in: a
   Treadmill toggle in `WalkConfig`, skip `startGpsWatcher` in `walk-active.tsx`, save tagged
   `activityType: 'treadmill'` with distance/pace/route forced null in `walk-summary.tsx`.
   `cardio-trends.ts` already filters on `!= null`, so no further changes needed downstream.
5. **Q-67.** `ScaleBleService.kt` runs `START_STICKY` (persistent since 2026-08-01) and shows an
   ongoing `IMPORTANCE_LOW` "Connected — listening for weigh-ins" notification for as long as it's
   alive — essentially always. Fix: drop that specific ongoing-status channel to `IMPORTANCE_MIN`
   (bumping the channel id, since Android won't retroactively lower an existing channel's
   importance on upgraded installs); leave the one-shot logged/skipped/failed/pending event
   channels untouched. Oura Ring and the chest strap show the identical pattern — flagged as an
   open question for the owner, not changed here.
6. **Q-68.** `lib/activity/auto-detection-service.ts` — the AD-1 sensor-fallback notify path
   (`:320-332`) already gates the "Activity detected" notification behind `shouldNotifyActivity()`
   (real GPS distance ≥200m **and** elapsed ≥90s). The AD-2 ring-confirm path (`:407-421`) — the one
   actually active whenever a ring is connected, i.e. the common case — fires the same notification
   the instant `pushGaitWindow` confirms ~90s of in-band cadence, with **zero** distance
   corroboration. This is distinct from the already-tracked "Hz bands provisional/uncalibrated"
   Known Issue (which needs an owner on-device calibration capture and is out of scope). Fix: add a
   GPS-distance **veto** (not requirement) to the ring path — if GPS points exist for the confirm
   window and show implausibly little movement, don't trust the cadence confirmation; if GPS has no
   points at all (genuinely indoor), keep trusting the ring alone as today.
7. **Q-69.** `lib/scale-ble/apply-reading.ts` — only the day's first confirmed scale reading ever
   sets the `body_metrics` weight trend (`hasConfirmedScaleTrendForDate` boolean gate,
   `adapter.ts:1849-1860`); every later same-day reading is archived to `scale_raw_samples` but
   discarded from the trend. Owner's concern: a clothed first reading locks in a wrong trend value
   for the whole day with no correction path. **Decided against** both a same-day average (blends a
   bad reading into the trend instead of replacing it) and a manual "use this reading instead" UI
   button (unnecessary — see decisions below). Fix: compare each new confirmed reading against the
   day's current trend and overwrite only if strictly lower — clothes only ever add weight, so a
   later nude reading naturally wins, while an ordinary day's fasted-morning reading is already the
   low point and is unaffected.

## Deliberately NOT done

- **No implementation for any of the seven.** Per the backlog-driven protocol this is the docs-only
  planning PR; each fix is its own PR 2, on its own branch, independently mergeable.
- **Q-64's real fix (native STT plugin) was not built or even dependency-checked against npm** — the
  plan flags `@capacitor-community/speech-recognition` as the candidate but explicitly defers
  confirming its Capacitor-8 compatibility to implementation time.
- **Q-67 does not touch Oura Ring's or the chest strap's identical persistent-notification pattern**
  — only the scale was reported, so only the scale is queued. The plan says to ask the owner before
  touching the other two.
- **Q-68 does not attempt to recalibrate the gait-classifier Hz bands** — that's the already-tracked,
  already-blocked-on-owner-capture Known Issue; this fix is a narrower, independently-valid gap
  (missing notify-gate corroboration) found alongside it, not a substitute for the real calibration
  work.
- **Q-69 does not add any new storage or a manual-override UI** — both were considered and explicitly
  rejected in favor of the lowest-reading approach; see decisions below for why, so a future session
  doesn't re-litigate this.

## Key decisions (with rationale)

- **Q-69 — average rejected.** Body weight naturally swings 1-3kg+ across a day from food/water/
  glycogen, not real fat/muscle change. Averaging a clothed reading with a nude one launders the bad
  reading into the trend rather than replacing it, and more generally makes the trend track "average
  daily hydration state" instead of a stable, comparable baseline — worse for tracking real change,
  not better. This mirrors why apps like Withings/Happy Scale and most recomp-tracking guidance use
  "first weigh-in of the day, ideally fasted" rather than an intraday average in the first place.
- **Q-69 — manual "use this reading instead" button rejected as unneeded**, once the owner realized
  the lowest-wins default handles their actual scenario (clothed-first, nude-second) automatically,
  with no user interaction required and no new storage (every reading is already archived to
  `scale_raw_samples` regardless).
- **Q-69 — lowest-wins, not "most recent", not "highest".** Chosen specifically because clothes are
  a one-directional weight artifact (only ever adds), so biasing toward the minimum among
  already-plausibility-checked readings targets exactly that failure mode without reintroducing the
  noise problem an average would cause.
- **Q-68's veto is conditional on GPS data existing**, not an unconditional distance requirement —
  because AD-2's entire point was that the ring works where GPS doesn't (indoors). Requiring GPS
  distance unconditionally would silently break genuinely GPS-less indoor walk detection, the exact
  case AD-2 was built to handle better than GPS alone.
- **Q-66 reuses the existing `activity_types.treadmill` row and `isDistanceBased` gate pattern**
  rather than inventing a new mechanism, because the manual-logging flow already solved this exact
  problem and the downstream aggregates (`cardio-trends.ts`) already tolerate null pace/distance
  safely (`!= null` filters), so no further changes are needed once the two write paths agree.
- **Filed under `cross`, not a single pillar** — same reasoning as the 2026-08-02 batch handoff:
  seven pillar-tagged items, one triage session. Linked explicitly from all five affected pillar
  indexes rather than relying on the `docs/handoff-*-<pillar>-*.md` glob.

## Gotchas / what did NOT work

- **Don't assume "voice logging exists in the code" means it was ever verified working** — the
  Web Speech API path in `set-card.tsx` was added without ever being tested against the real
  (WebView, not Chrome) target; `docs/planned_upgrades.md` still lists it as an unplanned/unbuilt
  Batch O item despite the button existing in the tree. Code presence ≠ shipped-working.
  (Q-64)
- **The AD-2 "fix" from 2026-07-23 only fixed the notify gate for the path it replaced (AD-1
  sensor-fallback), not the new path it introduced (AD-2 ring-confirm)** — a classic "fixed the old
  code path, the new one quietly inherited the original bug in a different shape" trap. Worth
  checking for this pattern (old mitigation not carried into a new/replacement code path) elsewhere
  in the auto-detection service if it's touched again. (Q-68)
- **Q-69's fix composes with the existing rank-merge (`health-source.ts`) for free** — no special
  case needed to protect a `manual` weight entry from being overwritten by a lower scale reading;
  `upsertBodyMetrics`'s existing merge already handles it. Don't add a redundant guard for this when
  implementing.

## Files to look at

- `docs/implementation-backlog.md` — Q-63 … Q-69, each with branch name + plan link + rationale.
- `components/workout/active-workout-screen.tsx:518-520,699-701,152-159,731-743` — Q-63 (skip
  button + the existing `withConfirm`/`ConfirmDialog` machinery to reuse).
- `components/workout/set-card.tsx:53-105` + `android/.../AndroidManifest.xml` — Q-64.
- `components/workout-screen.tsx:1696-1758` — Q-65 (both PiP branches, for comparison).
- `components/guided-walk/{walk-config,walk-active,walk-summary}.tsx` +
  `components/activity/active-activity-screen.tsx:40` — Q-66.
- `android/.../scale/ScaleBleService.kt:216-235` — Q-67.
- `lib/activity/auto-detection-service.ts:320-421` + `lib/activity/gait-confirm.ts` — Q-68.
- `lib/scale-ble/apply-reading.ts` + `lib/data/postgres/adapter.ts:1849-1860` +
  `app/api/scale-ble/today/route.ts:20-25` — Q-69.

## Open questions / blockers

- **Q-67:** does the owner want Oura Ring's and the chest strap's identical persistent "Connected"
  notification quieted the same way? Not assumed — ask before touching those two services.
- **Q-64:** confirm `@capacitor-community/speech-recognition` (or equivalent) actually supports
  Capacitor 8 before committing to it as the dependency; the plan explicitly leaves this open.
- **Q-68:** the true Hz-band calibration fix remains blocked on the owner performing a real captured
  walk/run/lifting session — unchanged by this batch, tracked separately in `projectOverview.md`.
- **None of these seven block each other** — any can be picked up independently, in any order, by
  whichever session picks up the top of the queue next.

## Pickup prompt

```
Work the top of the implementation backlog: Q-63 (the top-most item added in the 2026-08-02/03
owner bug/feature batch) from docs/implementation-backlog.md, unless a fresher session has since
reordered the queue — re-check the file first.

Read, in this order:
1. projectOverview.md — read with offset/limit if needed, it can exceed the Read tool's line limit.
2. docs/domains/workouts/README.md — the pillar index for Q-63.
3. docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md — this file: all seven root causes with
   file:line, the decisions and their rationale (especially Q-69's average-vs-lowest-reading
   reasoning, and Q-68's GPS-veto-not-requirement design), and the traps.
4. docs/superpowers/plans/2026-08-02-workout-skip-exercise-confirmation.md — the Q-63 plan.

Then:
  git fetch origin main && git remote prune origin && git checkout -B fix/workout-skip-confirm origin/main

First concrete action: Task 1, Step 1 in the plan — add a `confirmSkip` wrapper next to the
existing `withConfirm` in components/workout/active-workout-screen.tsx that always opens the
"Leave this exercise?" ConfirmDialog regardless of timerStarted/workoutPhase, then wire both skip
call sites (line 518 and line 699) to it.

Constraints you would otherwise rediscover:
- This is a pure client-state UI fix — no migration, no offline-sync surface, no device-only path.
  Standard pnpm dev verification is sufficient; no APK/device gate applies.
- Don't also fix Q-64/54/55/56/57/58 in this PR — each is its own independently-mergeable branch,
  by design (per the backlog protocol and this batch's own "don't need to merge till we say
  complete" instruction from the owner).
- Verify on the local dev server before merging (CLAUDE.md): start a normal (non-solo) workout,
  tap skip before starting Set 1 and again mid-rest, confirm "Stay"/"Leave" both behave correctly,
  and confirm solo-mode's existing confirm behavior is unchanged.
- Bump package.json (patch) and add a lib/changelog.ts entry in the same PR if this ships — it's a
  user-visible behavior change. Write them last, once the diff is final.
- Fold the journal entry + projectOverview.md update into this same PR before merging, per the
  standing end-of-session rule — don't leave it for a follow-up.
```
