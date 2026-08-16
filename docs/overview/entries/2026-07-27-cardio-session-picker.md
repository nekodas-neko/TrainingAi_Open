# 2026-07-27 — Cardio session picker (cardio batch item 1)

Branch: `feat/cardio-session-picker` · v1.213.0

## Why

Second item in the cardio/running redesign batch — see
`docs/superpowers/specs/2026-07-26-cardio-system-spec.md` and
`docs/superpowers/plans/2026-07-27-cardio-session-picker.md`. Phase 1 (the Cardiovascular hub,
`docs/overview/entries/2026-07-26-cardio-hub-phase-1.md`) shipped a quota dashboard and a plain
three-way modality picker with no help deciding between them. This item adds a "how much time do
you have?" flow that recommends one.

## What shipped

- **`lib/health/session-picker.ts`** — pure `recommendSession({ minutesAvailable, runningPlan,
  quota })`. Recommends `run` only when today's pending prescription fits the time budget
  (with `RUN_FIT_SLACK_MIN = 5` minutes of slack), carrying the running program's own
  `gateAction`/`gateReasons` when it's soften/rest. Otherwise recommends `walk` for the biggest
  **training** zone still open (Z2-Z5 — Z1 explicitly excluded, same passive-zone rule as
  `zone-quota.ts`'s D-10 exclusion), or `activity` when the week is fully on track. 7 unit tests.
- **`components/cardio/time-picker-sheet.tsx`** — 15/30/45/60-minute buttons, a recommendation
  card (with the gate note when present), and three always-tappable Run/Walk/Activity buttons —
  the recommendation is a suggestion, never a lock (spec D-9).
- **`cardio-content.tsx`** now also fetches `/api/running-plan`, reusing the **existing**
  `'running-plan'` cache key the `/running` screen already reads — no new route, no new cache
  entry. `modality-picker.tsx` gained a "How much time do you have?" entry point above its three
  existing rows.
- **No cross-modality recovery gate** — by design, not an oversight. `applyRecoveryGate()`
  branches on a running `Prescription`'s type, so it has no walk/activity equivalent; extending
  it was explicitly scoped out of this plan as a bigger, undesigned question for a future item.

## A real bug the test itself caught

The first draft of `recommendSession` picked "the open zone with the most remaining minutes"
without excluding Zone 1 — which fills passively per D-10 and is excluded from every other
training-zone view (`ZoneQuotaCard`'s totals, the hub's card). Two of the seven unit tests failed
immediately because the test fixture's default (every zone "open" unless overridden) happened to
leave Z1 with more remaining minutes than the zone the test intended to exercise, and the
implementation dutifully recommended closing Z1 — reproducing the exact "would you like to walk
to fill your passive recovery zone" nonsense the hub's own display explicitly avoids. Fixed by
excluding `PASSIVE_ZONE_ID` from the walk recommendation's zone pick, mirroring the exclusion
already established in `zone-quota.ts`, and by fixing the test fixture's default so each test's
premise is unambiguous rather than accidentally-correct.

## Verification

- `tsc` clean · lint 0 errors (same 112 pre-existing warnings, none in touched files) ·
  **2067 tests pass** (7 new) · `check-push-mutations: OK` · `next build` clean (isolated from
  the dev server, per the Phase-1-established `.next`-collision workaround).
- **Dev-server + Playwright**: signed in, opened `/cardio`, tapped "How much time do you have?",
  confirmed the sheet renders with all four minute buttons, the recommendation card, and all
  three Run/Walk/Activity buttons. With the seed's no-running-plan state, the recommendation
  correctly picked `walk` targeting Z2 (108 min remaining, the largest of Z2-Z4 — Z5 is
  `not-required` for the seed's `zone2-base` framework) — confirming the Z1-exclusion fix holds
  in the real render, not just the unit test. Screenshot captured.

## Not verified

- **The `run` recommendation branch.** The local seed has no active running plan, so a pending
  prescription that fits the time budget — and the softened-gate note that comes with it — was
  never exercised against real data, only against the unit tests' synthetic inputs.
- **On-device (S25 APK).** Same caveat as every prior cardio-hub surface — safe-area and Samsung
  WebView paint of the new sheet are unconfirmed; the sandbox render is desktop Chromium.
- **The recommendation heuristic's real-world quality.** "Recommend the zone with the most
  remaining minutes" is a first cut, not tuned against actual usage — expect it to want
  adjustment once it's been used for real decisions rather than synthetic seed data.
