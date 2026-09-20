# 2026-09-20 — BF-179: a dismissed prescription that expired three days ago was still prescribing 52%

**Branch:** `lane-a/bf179-expire-dismissed-prescription` · **Lane A** · the expiry gap only; the
*pending-looking card* question is narrowed below but not closed.

## What was wrong

The ageing-out check in `reevaluatePrescriptionForToday` was an **allow-list** naming
`auto_applied`, `accepted` and `consumed`. `dismissed` was in neither that set nor the deliberate
`pending` carve-out — so `needsRegenerate` never fired, and `workout-data/route.ts` took the
else-branch, which **re-stamps the stale prescription and writes it back**. The expired offer was
not merely tolerated, it was refreshed on every tab-open.

The owner saw it as a session screen with every exercise at 52% and a Deload chip, asked against an
explain screen reading **100/100 STRONG FIT**, streak 0 days, sore muscles None, HRV well above
usual. His *"why does it say deload when every signal says I'm fine"* had a real answer: **nothing on
that explain screen produced it.** The explain signals feed `computeDeloadStrength`, which gates on
`consecutiveTrainingDays < 3` and returned `{ recommended: false }`. The banner is the periodization
prescription, a different system with its own lifecycle that never consulted today's signals.

**This is Q-229 returning through a status its fix did not name** — and the file said the symptom out
loud in its own comment: *"an 8-day-old deload-era 52% served on a live Intensification day."*

## The shape of the fix is the point, not just the fix

It is a **deny-list** now — every status ages out on expiry except `pending` and `none` — where the
entry could have been satisfied by adding `dismissed` to the existing allow-list.

An allow-list is wrong here by construction. `PrescriptionStatus` has six members; the check named
three; the bug *was* the gap. Adding a fourth name leaves the next status added to that union as the
next silent gap, and nothing fails when it happens. A deny-list ages out by default and a new status
has to argue for its exemption. Both exemptions carry their reason in the code: `pending` is an offer
whose expiry the emergency-deload suppression already owns, and `none` means there is nothing to age
out, so regenerating on it would loop with nothing to show for it.

## What the production read changed

The entry's measured table — `prescription_status: dismissed`, expired 2026-09-17,
`phaseAction: deload_recommended`, `deload: true` — **no longer exists.** Measured 2026-09-20 across
all 15 of the owner's `session_periodization` rows:

| status | rows | expired | with `deload_recommended` |
|---|---|---|---|
| `pending` | 5 | 1 | 0 |
| `consumed` | 5 | 0 | 0 |
| `auto_applied` | 5 | 5 | 0 |

**There is no `dismissed` row at all, and not one row anywhere carries `deload_recommended`.** The
row regenerated at 2026-09-19 23:10, exactly as LA-122 item 1 anticipated.

Two consequences, and they pull in opposite directions:

- **The defect is still real.** It is a code-level gap, independent of whether a dismissed row
  happens to exist today. Nothing about the regeneration fixed the branch.
- **It cannot be reproduced from current data, and that narrows the open question.** The entry left
  two candidates for the *pending-looking card*: a stale client cache, or a status divergence. The
  server side can no longer produce a deload banner for any session — so if the 52% is still on
  screen, **candidate 1 is the only one left standing**. That is worth more than the owner's
  yes/no on its own, because it makes the answer diagnostic either way.

## Verification

- **9 tests**, all timestamps derived from the clock rather than hardcoded, per the repo's
  rolling-window rule.
- **Mutation pass, three mutations:**
  - reverted to the old allow-list (the bug) → **2 red**, both the `dismissed` cases.
  - status test dropped entirely, the obvious over-broad "fix" → **2 red, and they are both
    controls** — `pending` and `none` are exactly what a lazier fix breaks.
  - rewritten as an equivalent `!['pending','none'].includes(...)` (the deliberate control) →
    **9 green**.
- The existing `lib/__tests__/reevaluate.test.ts` passes unchanged (28 tests across both files).

## Not exercised

- **No device look.** The 52% is what the owner sees, and only the APK proves it is gone. Both
  halves are TypeScript, so this ships via Railway with no APK.
- **The regenerated prescription path was not driven end-to-end.** The unit test asserts
  `needsRegenerate: true`; that `workout-data/route.ts` then actually regenerates rather than
  re-stamping is covered by the existing route behaviour, not by a new test of mine.
- **The second candidate is narrowed, not settled.** Confirming a stale client cache needs the
  device — clear the cache, reopen the tab, see whether the chip goes.
