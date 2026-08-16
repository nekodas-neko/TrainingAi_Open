# 2026-07-29 — Exercise Readiness rework: body map, recovery-driven soreness, time constraints

**Branch:** `feat/readiness-checkin-rework` · **Version:** v1.235.0 · Owner-directed, in-session.

The check-in is opened before every session, and three of its four sections were doing the wrong
job. Owner decisions taken up front (see §Decisions).

## What changed

**Sore muscles** — pills on the left, the shared `MuscleHeatmap` body map on the right, reflecting
the selection live.

**"Sore" now means "not recovered"** (owner call). Any muscle trained within 48 h *and* still under
`RECOVERED_PCT` (85) on `computeMuscleRecovery`'s curve is **auto-selected**, marked `↻`, and counted
as sore. Both conditions matter: that curve scales its time constant with how hard the muscle was hit
(16–48 h), so 47 h after a heavy leg day is ~63 % recovered while 47 h after a light one is ~95 % — a
flat clock would flag the second for no reason. Matching goes through the existing `moodMuscleMatches`
rather than a second synonym table.

Auto-selecting was checked against real data before committing to it, because a sore muscle in
today's session deloads its exercises. **Of the last 10 production sessions, 8 had zero muscle overlap
with the session before** — the split is cleanly separated, so on most days this marks muscles that
aren't trained today and changes nothing (only `soreMusclesInSession` deloads). The two that did
overlap were back-to-back leg days at 46–47 h (glutes, hamstrings), which is precisely the case worth
deloading: 2 of 5 exercises, under the "more than half → whole-session deload" threshold, and the
emergency rule needs a gap under 36 h so it can't fire there either.

A muscle auto-marked and then turned **off** keeps a dashed outline, so an override is visible rather
than looking untouched.

**Issues** — `tired_legs` ("Heavy Legs") and `low_motivation` removed: one is soreness, the other is
an energy level, and both now have their own section. The `BodyState` union keeps them so historical
logs still parse; they are simply no longer offered.

**Sick/Unwell now does something.** It was stored and never read by the engine. It now:
- forces `deloadOrRestRecommended` + `strength: 'strong'` in `ai-dynamic.ts` (rest-day recommendation);
- is a standalone `shouldTriggerEmergencyDeload` trigger, so training anyway gives a deloaded session;
- is re-checked on the consumption-day read path (`reevaluate.ts`), so it lands on the fetch right
  after the check-in rather than waiting for the next full generation.
It is **offered, never imposed** — the existing already-deloading suppression still applies, so it
can't re-fire every prescribe call and pin `sessions_in_phase` at 0.

**Time Constraints** — Quick / Normal / Long in the check-in, sharing the *stored prescription* with
the pre-workout picker, so the two controls are one value rather than two that drift. Presets are now
**relative**: the session's own budget ±30 (`DURATION_PRESET_DELTA_MIN`), floored at
`MIN_PRESET_BUDGET_MIN` (20). The old fixed 30/90 only happened to be right for 60-minute sessions;
a 45-minute session's "quick" would have been a 30-minute *increase*.

## Two bugs found while verifying

1. **The duration control was clobbered by its own fetch.** `cachedFetch`'s `onData` resolves seconds
   after the tap (a rebuild is a real round-trip) and answered with the *pre*-rebuild preset, snapping
   the segment back. Guarded with `userPickedPresetRef` — the CLAUDE.md rule about never letting a
   server response replace an optimistic write, in a new place.
2. **Dropped exercises escaped the role set cap.** `fittedSets` only contains survivors, so a dropped
   exercise fell through to the model's raw count — production-shaped output stored an accessory at
   **5 sets against its ceiling of 4**. Dropped entries are still kept in the prescription
   (`droppedExerciseIds` filters at render), so they must carry a plausible shape. Now falls back to
   the role-capped counts. The read-side cap (v1.233.1) was masking this in the UI.

## Decisions (owner, 2026-07-29)

| question | decision |
|---|---|
| Where does the time picker live? | Both check-in and pre-workout, sharing one stored value |
| What does "sick/drained persist" mean? | Stored per-day + surfaced for sleep/readiness tuning — **not** carried over between days |
| How forceful is Sick/Unwell? | Recommend rest; deload if you train anyway. Never blocks training |

## Verification

- 2650 tests green (349 files); 18 new (`suggested-soreness`, `duration-presets`, emergency-deload
  illness). Lint, `tsc`, custom rules, and `next build` clean.
- **Driven in a real browser at a 412×915 (S25-shaped) viewport** via Playwright against `pnpm dev`,
  authenticated as the seeded user: all four sections render; selecting muscles highlights them on the
  front and back figures; Sick/Unwell shows the rest-day warning; picking **Quick** POSTs
  `/prescribe` (200) and the segment stays selected.
- **Auto-marking verified against a seeded real session**: a session moved to 20 h ago left chest at
  57 % recovered, and the sheet opened with Chest — and only Chest — selected, `↻` marked, amber on the
  body map, with "Chest is sore and in today's session — those exercises will be lightened."
  Shoulders showed the in-session dot without being marked, being recovered.
- **Verified the plan actually shrank**: the stored prescription came back
  `durationPreset=short`, estimate 38 → **24 min**, one exercise dropped — and after the cap fix the
  accessory stores 4 sets, not 5.

**Not verified:** on-device (Samsung WebView, real safe-area insets, haptics). The sheet adds no
`pb-safe` of its own — `SheetContent side="bottom"` owns the bottom inset per CLAUDE.md — but that is
reasoning, not an on-device observation. The auto-marking was exercised against a seeded recent session (above), but not against the
owner's real multi-week history — the 8-of-10 no-overlap figure is a measurement of production data,
not an observation of the UI running on it.
