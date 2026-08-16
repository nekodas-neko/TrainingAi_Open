# 2026-08-14 — AI prescriptions actually expire now (Q-229)

**Branch:** `claude/trainingai-backlog-v0abea`

`prescriptionExpiresAt` was written correctly at generation — 7 days out — and then read in exactly
one place: `shouldTriggerEmergencyDeload`, which asks only whether a still-*pending* deload offer is
still on the table. Nothing ever aged out a prescription the lifter was actually training against.

`reevaluatePrescriptionForToday` is the sole gate on `needsRegenerate`, and its triggers were an
emergency-deload signal and whole-session soreness. No calendar branch. Its own doc comment stated
the intended design outright — *"a prescription generated after the previous session is consumed up
to 7 days later"* — so the boundary was real, documented, and unenforced. A session type left unused
past its window replayed its last AI-computed pct/sets/reps until an unrelated signal happened to
fire. The owner hit it as an 8-day-old deload-era 52% served on a live Intensification day.

Nineteen lines, before the soreness re-derivation:

```ts
if (
  (state.prescriptionStatus === 'auto_applied' || state.prescriptionStatus === 'accepted' ||
    state.prescriptionStatus === 'consumed') &&
  state.prescriptionExpiresAt != null && state.prescriptionExpiresAt <= now
) {
  return { prescription, changed: false, needsRegenerate: true }
}
```

**Order matters and is tested.** Expiry is checked *before* the deload re-derivation, so an expired
prescription is replaced rather than patched — otherwise a stale plan could be "refreshed" into
looking current while its percentages stayed eight days old.

**`pending` is deliberately excluded.** Its expiry already means something else: it is what the
emergency-deload suppression reads to decide whether to stop re-offering. Ageing it out here would
have two functions racing over one field for two purposes. The backlog entry asked whether the
suppression window should change too; the answer is no, and the exclusion is what keeps them
separate. Note there are **two** copies of that suppression, not one as the entry said —
`emergency-deload.ts:19` and `generate-prescription.ts:218` — both gating `pending`, both untouched.

No caller change was needed: `workout-data/route.ts` already handles `needsRegenerate` by firing
`regeneratePrescriptionInBackground` and serving the existing prescription for this render, which is
the right behaviour for an expired one — something beats nothing while the LLM runs.

## What the production numbers actually said

The entry's blast-radius sweep was listed as not-yet-done. Measured 2026-08-14T03:05Z: five
prescriptions carry an expiry and **none was currently expired**. The row the entry cites,
`a4fec65d`, had regenerated at 2026-08-13T23:34 — about an hour after the entry was written — when
that session was next actually run.

That is not a refutation, it is the shape of the bug: stale state **self-clears the moment the
session is used**, so the fault is invisible in a snapshot and only bites in the gap between runs.
It also means this is a live, dated prediction rather than a reconstruction — row `5e04a6d9`
(`auto_applied`, generated 2026-08-08) expires **2026-08-15T23:47Z**, and before this change, not
running that session type by then would have started the replay.

`claude_ro` is row-scoped to one user, so "none currently expired" is a statement about the owner's
rows, not about anyone else's.

## One property worth knowing

While a prescription is expired the re-evaluation block re-enters on every `workout-data` read,
because only the non-regenerate branch stamps `reevaluatedInputsKey`. So the background regenerate
can fire more than once before it lands. That is the pre-existing behaviour of the two triggers that
were already there, it is bounded by the `prescribe:` rate limit (20/hour/user), and the condition
resolves itself the moment regeneration writes a new expiry. Left as-is rather than special-cased.

## Verified

Six new cases in `lib/__tests__/reevaluate.test.ts`, all deriving their dates from an injected clock
rather than pinning an absolute one — a fixture with a hardcoded date on one side of a rolling
comparison is the `scale-ble-day-keying` time bomb.

**Mutation-verified three ways:** deleting the branch fails 4 cases; widening it to include `pending`
fails 1 (exactly the one written for that boundary); flipping `<=` to `>` fails 5.

Full suite green — **461 files, 3,816 tests**. `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33.

**End-to-end on the dev server, observed rather than reasoned about.** The unit tests cover the
decision; this covers the wiring. Seeded the local DB with an `ai_dynamic` program and an
`auto_applied` prescription generated 9 days ago, expired 2 days ago, flat 52% across every exercise,
`reasoning: 'q229 fixture'`. One authenticated `GET /api/workout-data?tab=<sessionId>` returned 200 —
and the row was then replaced: a real regeneration had run, landing a fresh prescription at 06:15:08
with a **new 7-day expiry** and Intensification-appropriate **84% 4×4** on the main compounds. The
fixture's reasoning string is gone from the row. That is the whole chain — expiry detected in shared
code, `needsRegenerate` honoured by the route, Gemini called, new expiry written — and it is exactly
the behaviour the owner's 8-day-old 52% should have got. The fixture was reverted afterwards
(`phase_mode` back to `manual`, the periodization row deleted).

**Not exercised:** the S25. Nothing here is device-shaped — it is a server decision and the client
just renders whatever numbers arrive — but the pre-workout screen's "preparing your AI workout" state
during the regeneration window is a UI beat this sandbox does not watch.
