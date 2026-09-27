# LB-165 — the fallback plan I shipped was reaching nobody

**Branch:** `lane-a/lb165-rules-plan-reaches-the-screen` · **Lane A**.

## What this corrects

RV-202 ① (mine, earlier) made the model-failure path return the program's own numbers instead of
a 502. The measurement was real — HTTP 200 where there had been 502 — and it was about the
**route**. LB-165 measured the **screen**, and nothing changed there: still ten 3-second polls,
still ~30 seconds of "Preparing your AI workout…", still the amber "couldn't generate" banner.

My own comment in that code asserted the benefit that did not exist: *"this plan is only what
today's caller is handed."* No caller was reading it.

## The chain, verified rather than taken on trust

Two links decide it, and both were checked against `main`:

- `workout-data`'s `regeneratePrescriptionInBackground` is **fire-and-forget** — it passes
  `onError` and never consults the result.
- `isAiPrescriptionPending` returns true purely on `prescriptionStatus === 'consumed'`, and only
  `storePrescription` clears that. Not storing meant the status never flipped, so the screen
  stayed "preparing" regardless of what the route returned.

## The fix

The catch now stores the rules plan with `RULES_PRESCRIPTION_TTL_MS` (6 hours).
`storePrescription` defaults the status to `'pending'`, which is what makes the screen paint.

**Why storing is right now when RV-202 refused it.** RV-202's objection was to the **seven-day**
hold — one provider blip becoming a week of uninformed plans — and that part still stands. Its
*conclusion* rested on the plan reaching the caller, which it did not. The objection is answered
by the expiry instead of by refusing to store: six hours covers the session in front of the lifter,
and `reevaluate` re-generates once `prescriptionExpiresAt` passes, so the model is tried again the
same day.

A duration rather than a local-day boundary, deliberately: a day boundary needs calendar
arithmetic and a timezone, and buys nothing over "a few hours from now".

## The test that pinned the old decision, inverted on purpose

It asserted the branch *never* stores. The property it was really protecting was "the model gets
another attempt soon" — so that is now pinned on the **expiry**: it must store, and must never use
the seven-day default. A second test holds the TTL to hours rather than days, so a constant that
crept upward would fail. Phase state must still not move; that half is unchanged.

## Verification

- `packages/shared/src/ai-periodization`: **148 passed (15 files)**.
- **Mutation pass: baseline survives, 3 killed, 1 equivalent control survives.** Killed: dropping
  the store call; a seven-day TTL; a 30-second TTL. Control: `6 * 3600 * 1000`.
- `tsc` clean; `pnpm build` clean; Custom Rules **82 of 82**.
- v1.477.6 with a changelog line — this is user-visible.

## Not exercised

**No device run, and the failure path cannot be induced here at all:** it needs the Gemini call to
fail, which the sandbox cannot force. What was verified is the code path and the state machine —
that `storePrescription` sets `'pending'`, and that `isAiPrescriptionPending` keys on `'consumed'`.
What is owed on the phone is that a real model outage now paints the base numbers rather than the
amber banner.

## Left for others

`RV-202 ③`'s third label case (`From your program`) in `components/workout/numbers-source.ts` is
now unblocked, because the client can see `source: 'rules'` on the stored plan. That is Lane B's
one-liner and LB-165 keeps it.
