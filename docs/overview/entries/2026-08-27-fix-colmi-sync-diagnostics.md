# 2026-08-27 — Colmi R09: the heart-rate request was missing its day

Branch `fix/colmi-sync-diagnostics` · PR #566 · follows
[2026-08-26-alternative-ring-testing](2026-08-26-alternative-ring-testing.md)

## What this fixes

Every enabled metric on the R09 landed except heart rate, which stayed at zero rows across three
syncs. The request was a bare `0x15` — Gadgetbridge sends `[0x15, <int32 LE local midnight>]`, and
this ring answers a command it cannot parse with **silence rather than an error**. A silent ring and
a ring with no history are the same observation from our side, which is why this read as "no data"
for a day rather than as a malformed request.

`cmdSyncHeartRate(dayStartSeconds)` now carries the day, and `localDayStartSeconds()` derives it
from the user-local date string rather than from `Date.now()`.

Two changes ride with it, both of which exist so the next silence is diagnosable:

- **The sync card reports what the ring actually sent.** `diagnostics: { frameTags, unmapped,
  unmappedHex }` is surfaced under a "Sync detail" disclosure. Frame tags distinguish "the ring
  said nothing" from "the ring answered and we did not decode it" — the distinction that cost the
  day above.
- **The drain window went from 12 s to 30 s.** The ring returns history in bursts with gaps between
  them, so a short window truncates a real response into something indistinguishable from an empty
  one.

## What is verified, and what is not

Verified: `pnpm dev` against the local DB, the protocol and time-resolution unit tests, and the full
CI gate (60 of 60 Custom Rules steps).

**Not verified: any of it against the ring.** The fix is inferred from Gadgetbridge's request shape,
not observed working — no heart-rate row exists yet. The first sync after this deploys is the test.
Also unexercised: the day boundary. Every sample so far falls inside one local day, so
`resolveRelative`'s day-shift arithmetic has only ever run against unit fixtures. The first overnight
capture runs it for real.

## Ring state at the time of writing

Eight kinds present — steps, distance, calories, SpO₂, stress, temperature, HRV, battery — all
stamped 07:00 Brisbane or later, against auto-measurement switches enabled at 06:48. The ring
recorded nothing before them, which is the confirmation that the switches were off from the factory
and that the blank first night is the ring behaving correctly rather than a decode failure.

Sleep is still zero, for the same reason.

`calories` reads 1431 beside 485 steps and 328 m. 485 steps is roughly 20–25 kcal, so it is neither
a per-bucket figure nor the ×10 scaling some firmware applies; a running daily total is the fit. It
is stored raw and summed nowhere until a full day settles it — summing a cumulative counter would
produce an inflated number that still looks plausible.

## Note on the CI failure this branch hit

`e2e/food-row-shared.spec.ts` went red here and on no other branch. The cause was the base, not the
diff: #567 changed the meal-builder entry path and #568 is what makes the ingredient search
reachable again, and this branch had the first without the second. Merging `main` cleared it. Worth
recording because a nutrition e2e failure on a Bluetooth branch reads as unrelated noise, and the
correct response was to update the base rather than to dismiss it.
