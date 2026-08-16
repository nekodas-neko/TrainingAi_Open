# Auto Walk/Run Detection Still Fires Too Easily — Close the Ring-Path Notify Gate Gap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (owner report):** the background "Activity detected — Recording your walk or run…"
notification is still firing on ordinary movement around the house, well after the 2026-07-23 AD-2
change was supposed to fix exactly this (a garage lifting session was the original false-positive
case AD-2 targeted). Owner's screenshot shows it firing at 12:15pm, in the same minute as a scale
weigh-in — i.e. from brief incidental movement, not a real walk.

**Tech Stack:** TypeScript client (`lib/activity/auto-detection-service.ts` and
`lib/activity/gait-confirm.ts`). No native/Kotlin change, no migration.

---

## Root cause — a real gap, not (just) the already-known calibration limitation

Two things are true at once here, and it's important not to conflate them:

1. **Already known and already tracked** (`projectOverview.md`, "AD-2 ring-cadence walk/run
   detection … Hz bands provisional, NOT device-verified"): `gait-classifier.ts`'s walk/run Hz bands
   are physiological-prior estimates, not calibrated against a real captured session, and the file's
   own comment says not to hand-tune them further without real data. That real fix is blocked on an
   owner-performed on-device capture session and is **out of scope for this plan** — don't attempt
   to re-derive the Hz bands here.

2. **Not yet known/tracked, and independently fixable right now:** `onPoint()`'s sensor-fallback
   path (AD-1, `triggerSource === 'sensor'`) only fires `notifyActivityDetected()` after
   `shouldNotifyActivity()` passes — real distance (≥200 m) **and** real elapsed time (≥90 s)
   covered, not just "motion detected" (`auto-detection-service.ts:320-332`). But the **ring-confirm
   path** (AD-2, `triggerSource === 'ring'`, the subscribeGateFeed callback,
   `auto-detection-service.ts:407-421`) fires the exact same notification the instant
   `pushGaitWindow` confirms (~90s of in-band cadence) — with **no distance/elapsed corroboration
   at all**. Since the ring is "strictly the better trigger" and disarms the phone's motion sensor
   the moment it's live (`:381-384`), **the ring path is the one actually running on this device**
   (an Oura Ring was connected 3 minutes before the false trigger, per the same screenshot) — so
   this uncorroborated path is the one the owner is actually hitting, not the already-conservative
   AD-1 path.

In short: AD-2 gave the *confirmation* a much better signal (real cadence vs. GPS speed) but forgot
to carry over the *notify gate* AD-1 already had. A ~90s burst of in-band-classified motion — which,
per the still-open Hz-band/octave-ambiguity uncertainty, can absolutely happen from ordinary
non-walking movement — now notifies unconditionally, whereas before AD-2 it would have needed to
also cover real distance to ever reach the user.

## Fix — corroborate the ring confirmation with GPS distance, without blocking indoor-only walks

The tension to design around: GPS may have **zero points** for a real indoor walk (no fix at all) —
in that case the ring is supposed to work standalone, and requiring GPS distance would silently
break exactly the case AD-2 was built to handle better than GPS. So the corroboration must be a
**veto**, not a **requirement**: if GPS points exist for the confirm window and they show
implausibly little real movement, don't trust the cadence confirmation; if GPS has no points at
all, fall back to trusting the ring alone (today's behavior, unchanged).

### Task 1: Add a distance veto to the ring-confirm notify path

**Files:**
- Modify: `lib/activity/auto-detection-service.ts`

- [ ] After the existing backfill loop (`auto-detection-service.ts:412-415`, which already copies
  `probeBuffer` points into `sessionPoints` from `startMs` onward), read
  `useAutoDetectionStore.getState().sessionPoints` and, **only if it has ≥2 points**, compute
  `distanceM = computeTotalDistanceKm(pts) * 1000` and `elapsedSec = (pts.at(-1).t - startMs) /
  1000`. Reuse the existing pure predicate `shouldNotifyActivity({ distanceM, elapsedSec,
  alreadyNotified })` — same helper AD-1 already uses, already unit-tested
  (`lib/activity/__tests__/notify-gate.test.ts`) — rather than inventing a second threshold.
- [ ] If `sessionPoints.length < 2` (no GPS fix at all for this window — the genuinely-indoor
  case), keep today's behavior: trust the ring confirmation alone and notify.
- [ ] This only gates the **notification**, exactly like AD-1's comment already says at the top of
  the file ("These gate only the 'Activity detected' NOTIFICATION, not detection or saving") — the
  session itself still starts and still records on ring confirmation either way; this task doesn't
  touch save-path quality gates (`detection-thresholds.ts`).

### Task 2: Tests

**Files:**
- Modify: `lib/activity/__tests__/notify-gate.test.ts` (or add a sibling test file scoped to the
  ring-confirm path specifically if the existing file is purely about the pure predicate — check
  which before adding)

- [ ] Ring confirms, GPS shows ≥2 points covering <200 m / <90 s (e.g. shuffling around a room) →
  no notification.
- [ ] Ring confirms, GPS shows ≥2 points covering a real walk (≥200 m, ≥90 s) → notification fires,
  matching today's behavior for a real walk.
- [ ] Ring confirms, **zero** GPS points (denied/no fix) → notification still fires (must not
  regress indoor detection with GPS off/denied).
- [ ] `alreadyNotified` latch still holds (no double-fire) — this task changes *when* the check
  runs, not the one-shot-per-session guarantee.

### Task 3: Cross-reference the known-issue tracking (documentation only, same PR)

**Files:**
- Modify: `projectOverview.md`

- [ ] Add a dated note under the existing AD-2 Known-Issues entry (don't duplicate a whole new
  heading) recording this 2026-08-03 device-confirmed false positive as concrete evidence the
  Hz-band calibration gap is real, and cross-reference this plan/fix as the notify-gate mitigation
  that shipped alongside it — the Hz-band recalibration itself remains blocked on an owner capture
  session, unchanged by this plan.

### Task 4: Verification

- [ ] `pnpm dev`/unit tests only for the predicate logic — the ring-cadence path itself is
  BLE-gated and inert in the sandbox (no ring), per the existing Known Issue.
- [ ] **On-device (S25 + ring):** the actual repro case — brief stand-still/shuffle movement (e.g.
  around a scale weigh-in) with the ring connected — should no longer produce an "Activity
  detected" ping. A real walk started with the ring connected must still notify within the same
  ~90s window as before. Per CLAUDE.md, don't mark this resolved until this on-device pass actually
  ran — this exact bug already looked "fixed" once (the original 2026-07-23 AD-2 gate) and wasn't,
  for this specific path.
