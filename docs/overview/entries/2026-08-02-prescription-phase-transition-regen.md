# 2026-08-02 — accepting a phase transition emptied the prescription card for good (Q-38)

**Branch:** `fix/prescription-phase-transition-regen` · **Version:** 1.250.1 · Run-list item 2 of the
[batch queue drain](../../handoff-2026-08-02-platform-batch-queue-drain.md). Plan: Workstream D of
the [owner bug batch](../../superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md).

## What was wrong

Tapping **Move to Intensification** on the AI Prescription card left the pre-workout screen with
nothing, permanently, and no way back except waiting for the next completed session.

`advancePhase` clears the prescription slot and writes `prescriptionStatus: 'none'`; the transition
route then wrote `'none'` again. But every recovery mechanism keys on `isAiPrescriptionPending`,
which is `prescriptionStatus === 'consumed'` and nothing else. `'none'` matched none of them, so
after a transition there was:

- no card (the prescription is null),
- no "Preparing your AI workout…" placeholder,
- no bounded regeneration poll,
- no client-side `/prescribe` trigger,
- and no server-side regeneration either — `workout-data`'s own fire-and-forget is gated on the
  same flag.

The only thing left was the transition route's own server self-fetch to `/prescribe`, the exact
container→own-origin pattern `workout-screen.tsx:1519` already documents as unreliable in
production, which is why the open-time and completion-time triggers moved client-side long ago.

## What shipped

The status the transition leaves behind is now a named constant, `POST_TRANSITION_STATUS =
'consumed'`, in its own module beside the route — so the value carries the reason it must be that
value, and a test asserts `isAiPrescriptionPending` accepts it. `'none'` was not a typo; it reads
perfectly sensible in isolation, which is why it survived.

With the slot in the pending state, all five mechanisms above light up on their own. The server
self-fetch is deleted and the regeneration is fired by the client after the transition succeeds,
fire-and-forget — matching the two triggers that already work that way. Losing that call is
survivable by construction: the server state is pending, so the pre-workout poll and trigger
recover it on the next open.

## Decisions worth not re-litigating

**`advancePhase` was left alone.** It writes `'none'` as part of clearing the slot and has a second
caller — the respond route's accepted-deload path, which re-stores the prescription and writes its
own status straight after. Changing the shared function to serve one caller would have put a
transition-specific meaning inside a generic phase-advance. The route's own write is the one that
survives, so that is where the fix belongs.

## Verified on the dev server

Seeded an `ai_dynamic` program with a `transition_recommended` prescription, then:

- `POST /transition` → phase `accumulation`→`intensification`, prescription cleared, status
  `consumed` (was `none`).
- A/B on the same seeded row: `workout-data` reports `aiPrescriptionPending: false` with `'none'`
  and `true` with `'consumed'`. That single flip is the whole bug.
- Pre-workout screen at 412px with regeneration forced to fail: the spinner heading "Preparing your
  AI workout…" renders, the exercise list stays on screen, the Start button holds at "Preparing…",
  and the poll keeps ticking.
- With regeneration working: a fresh prescription lands within a few seconds and the placeholder
  clears on its own — the outcome the owner was missing.

Full suite green, lint and typecheck clean, custom rules pass.

## Not exercised

Pure TypeScript, so it reaches the device through a Railway deploy with no APK rebuild. Not run on
the S25 — but nothing here touches native, safe-area, offline storage or gestures, and the flow was
observed end to end in a real browser at the S25 viewport. No device-verification gate applies.
