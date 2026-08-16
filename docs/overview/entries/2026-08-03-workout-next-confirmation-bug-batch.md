## 2026-08-03 — owner bug/feature batch: triage + scoping (planning session, docs-only)

**Branch:** `claude/workout-next-confirmation-rkrs1u` · **Type:** planning PR (PR 1 of 2 per the
backlog-driven protocol — no implementation).

The owner walked through a batch of screenshots plus one feature idea, one at a time across a
single session, and asked each be scoped and queued (explicitly not merged yet). This session
traced all seven to source, discussed and rejected two alternative designs for the last one, and
wrote implementation plans; **nothing was fixed**.

### What was found

| Report | Root cause | Confidence |
|---|---|---|
| Workout skip button has no confirmation | `active-workout-screen.tsx:518-520` calls `onSkip` directly with no gate at all; `:699-701` only confirms in solo mode. `onSkip` is `advance()`, which discards in-progress set/rest state. | Source-verified |
| Voice logging dies instantly on the APK | No `RECORD_AUDIO` in `AndroidManifest.xml` at all, so Capacitor's own permission-grant flow for the WebView's audio-capture request silently fails; separately, embedded Android WebView doesn't reliably implement real STT even once fixed. | Source-verified |
| PiP shows no rest countdown on the exercise-summary screen | `workout-screen.tsx:1696-1705`'s PiP branch for that mode is a static placeholder that never reads `lastSetRestStartMs`/`lastSetRestSec`, unlike the `mode === "active"` PiP branch right below it which already solves this via `PipView`. | Source-verified |
| Guided walk needs a treadmill mode | Guided walk never got the `is_distance_based`/GPS-skip treatment the manual "Other activity" flow already has (`activity_types.treadmill`, `active-activity-screen.tsx:40`). | Source-verified |
| Scale's persistent "listening" notification is noise | `ScaleBleService.kt` runs `START_STICKY` (since 2026-08-01) with an ongoing `IMPORTANCE_LOW` "Connected — listening" notification for as long as it's alive. | Source-verified |
| Auto walk/run detection still false-positives | AD-1's sensor-fallback notify path already gates on real GPS distance+elapsed; AD-2's ring-confirm path (the one actually active with a ring connected) fires on cadence alone, no corroboration — distinct from the already-tracked Hz-band calibration gap. | Source-verified |
| Scale weight trend locks to a bad (clothed) first reading | Only the day's first confirmed scale reading ever sets the `body_metrics` trend (`apply-reading.ts`); later readings are archived but discarded. Owner decided against averaging (blends the bad reading in rather than replacing it) and against a manual override button, landing on "lowest confirmed reading wins" instead — clothes only ever add weight, so this targets the failure mode without adding noise to the ordinary case. | Design decision, discussed live with the owner |

### What landed

- Seven plan docs under `docs/superpowers/plans/2026-08-0{2,3}-*.md`, one per item, each
  independently implementable and mergeable.
- `docs/implementation-backlog.md` — **Q-63 … Q-69** inserted above Q-51, each with branch name,
  plan link, and rationale. Renumbered twice during reconciliation with two other parallel
  sessions' collisions (original 52…58 → briefly 57…62 → final 63…69). Next free Q number bumped
  to 70.
- `projectOverview.md` — Current Status note + a Known-Issues entry covering all seven, tagged and
  explicitly marked NOT fixed; the handoff pointer in the doc-map table updated to this session's.
- Domain indexes updated: `workouts`, `cardio`, `devices`, `platform`, `body`.
- `docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md` — full root causes, the two design
  decisions and their rationale (why average was rejected for the scale trend, why the auto-detect
  fix is a veto not a requirement), traps, and a ready pickup prompt for Q-63 (top of queue).

### Not exercised

Nothing was implemented, so nothing needed device verification this session. Several items carry a
hard device gate once actually built: Q-64 needs a new APK + a real on-device mic test; Q-67 needs a
new APK; Q-68's actual repro path is BLE-ring-gated and inert in the sandbox (no ring present).

### Owner-facing open questions (recorded, not resolved this session)

- Q-67: does the owner want Oura Ring's and the chest strap's identical persistent "Connected"
  notification quieted the same way, or is that one useful as-is? Not assumed.
- Q-64: `@capacitor-community/speech-recognition` (or equivalent) needs its Capacitor-8
  compatibility confirmed before implementation commits to it.

No version bump — docs-only, no user-visible change.
