# The step max-merge picked the biggest number, not the most trusted one (Q-22 §4)

The rollup decided whether to write the ring's daily step total by comparing it against whatever was
already stored — `mergedSteps > existingSteps` — reading that stored count **with no source filter**.
So a Health Connect total (rank 1) that happened to be larger than the ring's honest count (rank 3)
kept the ring's value from ever reaching `mergeSet`, which would have accepted it. The stored daily
total was whichever source produced the *largest* number.

Protecting higher-ranked sources was never this guard's job — `mergeSet` (`lib/data/health-source.ts`)
already does it per field, against that field's own last writer. Duplicating the job as a magnitude
comparison is what inverted the ladder. The guard's real remit is monotonic same-day accumulation
*within* the ring's own writes, so it now applies only when the stored value's `source_map.steps`
ranks at or above `oura_ble`. Below that, the value is offered and rank decides.

## Blast radius: measured before changing anything, and it is zero

| stored `source_map.steps` | days | range |
|---|---|---|
| legacy / null (rank 0) | 54 | 2026-05-01 → 06-23 |
| `health_connect` (rank 1) | 15 | 06-24 → **07-08** |
| `oura_ble` (rank 3) | 21 | **07-09** → 07-29 |

The two eras don't overlap, so no day is currently suppressed. The one way this fix could have
*changed* stored data is the 35-day rollup window still reaching back over 07-07 and 07-08, where
Health Connect owns steps — but those two days carry **zero gait frames** (`0x7e`/`0x7f` begin on
07-09), so the ring produces no total for them and cannot lower them. Worth stating plainly: the bug
was real but latent, and this is a correctness change, not a data change.

## Also verified, not fixed here

Q-22 §3 (`previewStepsBackfill` a hand-copied duplicate of the rollup block) was already fixed on
2026-07-28 — both now call the shared `computeStepsByDay`. Confirmed in source and struck; it had
been left un-struck.

## Verification

Two new DB-backed tests, both directions of the same rule: the ring corrects a lower-ranked source
downward however big that source's number was, and still refuses to lower a higher-ranked one however
small the ring's number is. **Confirmed red** by pinning `guardApplies` to `true` — the first fails,
the second and the seven existing tests pass, which is the right split (the second test passes under
both, since `mergeSet` was always doing that half correctly; it is there to pin that the fix didn't
trade one inversion for another).

## A second flaky test, found while chasing this PR's CI red — and this one had a cause

`oura-oauth-state.test.ts`'s "rejects a tampered or garbage cookie" failed on 1 of 3 local full
runs, then reproduced standalone at ~2 in 15. Its comment already recorded one previous fix for
flakiness, so the shape was familiar; the mechanism was not.

An HMAC-SHA256 signature is 32 bytes = **43 base64url characters**, and 43 × 6 = 258 bits carrying
256. The final character therefore holds only 4 significant bits, and its **low 2 bits are padding
the decoder discards**. The test "tampered" the cookie by flipping that last character to `'A'` or
`'B'` — and for the 4 of 64 characters that differ only in those padding bits, the tampered cookie
decodes to the *identical signature*, verifies, and the assertion fails. Predicted 4/64 = 6.25 %;
**measured 191/3000 = 6.37 %** against the real implementation.

Fixed by tampering a character in the **middle** of the signature, where every bit is significant.
30/30 clean afterwards.

Worth recording how nearly this went wrong: my first experiment "disproved" the theory — 0 collisions
in 4,000 iterations — because it signed a constant payload, so almost every cookie was identical and
the sample never varied the last character. The measurement that mattered ran against the actual
`signOuraState`. A negative result from a fixture that cannot vary is not evidence.

## Not exercised

Server-side only, no device path. The rollup was not run against production data — the blast-radius
numbers above come from read-only queries, not from a rehearsal of the write.
