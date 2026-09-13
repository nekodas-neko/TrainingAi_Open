# 2026-09-13 — the Rest-vs-plan card can be seen off the device (LB-98 ①)

**Branch:** `fix/lb98-rest-card-server-fallback` · **Agent:** Implementation Lane B

## The gap LB-98 named, and why it is a verification bug rather than a product one

`planned_rest_sec` is the snapshot taken when a set was logged — the honest number, because a later
style edit would rewrite what "prescribed" meant for a past set. It lives in the local store, so
`rest-prescription-card.tsx` returned `null` whenever `getLocalStore` did. On the canonical runtime
the card worked; **in every browser, and therefore in CI, it was simply absent.** Its rendering path
— two-column rows, signed deltas, a conditional compression sentence — had never executed anywhere
but the S25, and the card arrived owing a device check it could not discharge.

Lane A shipped the read half on 2026-09-09: `/api/health-trends?view=rest-adherence` emits
`restSets`, per-set `{ plannedRestSec, restTimeSec }` from the **logged** columns, shaped as the
card's own `RestSet`. LB-98's remaining residue was one line of Lane B wiring — *"nothing consumes it
yet, so the verification gap is not closed until that lands."*

## What changed

`RestPrescriptionCard` takes `serverSets` and renders `local ?? fromServer`. Three things about that
shape are deliberate:

- **Local still wins.** The device's store is the source of truth and needs no network. The prop is
  consulted only when there is no store, or when the store holds nothing to summarise.
- **It is a swap, not a second aggregate.** Both paths run the identical `restByPrescription` over
  the identical field names. LB-98 warns explicitly against moving the computation server-side —
  that is how one metric acquires two numbers — and this keeps it in one place.
- **No new request and no new cache key.** `trends-section.tsx` already fetches this exact response
  for this exact view, so `restSets` is a prop, not a second fetch. That also sidesteps the one-TTL-
  per-key rule entirely.

## Verification

`e2e/rest-vs-plan-card.spec.ts` — the first run of this rendering path outside the device. It asserts
the header, the set count, both rows' means (75 s at a 60 s prescription, *exceeded*; 110 s at 120 s),
both signed deltas, and the compression sentence with its range. A second test pins the honest
negative: no pairs must leave the card **absent**, not a heading over blank space, while the bars
above still draw so the assertion cannot pass against a screen that failed to load.

**Mutation-proven:** reverting `local ?? fromServer` to `local` fails the positive test on its own
message — *"the card is still absent off-device"* — and correctly leaves the negative one green.

**The response is stubbed, and the reason is worth recording.** A real fixture would need far more
than this card: the parent hides everything behind the *correlation's* `hasSufficientData`, which
wants paired sessions carrying a progression style and a 1RM baseline — conditions about the bars
above, not about these rows. The local seed also has 27 set logs and **zero** carrying either rest
column, so the data would have to be built regardless. Lane A's emit site is already pinned by five
mutants including one that swaps the logged snapshot for the live style, so what the stub leaves
untested is not the query.

- Custom Rules **74 of 74**, `tsc` clean, eslint clean, `pnpm test` clean, `pnpm build` clean.

## What this does and does not settle

- **Q-300's device check is narrower now, not gone**, and its entry has been corrected to say so: its
  `Keep:` asserted the card "is absent in a browser and cannot be verified in CI", which stopped
  being true today. What the S25 still owes is the **local** path — `getLocalStore` reading the
  device's own set logs — which no harness can reach.
- **LB-98 itself stays open** on residue ②, the `body_metadata` half (LB-96), still parked behind
  `Needs: OR-102b`.
- **Not device-verified.** The device path is unchanged by construction — `local` is preferred and
  computed exactly as before — but "unchanged by construction" is an argument, not an observation.
