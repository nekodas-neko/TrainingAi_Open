# LB-110's claims were all true and its conclusion was still wrong

**Lane A · branch `lane-a/lb110-body-battery-date-param` · docs only. No code shipped, deliberately.**

## What the entry asked for

LB-110 appeared in the queue on 2026-09-15: `/api/body-battery` takes no date, so TN-3b's past-day
half is blocked on an entry (`LB-102`) that does not exist. Scope: add a `?date=` param.

It was the first genuinely startable Lane A item in days — no gate, not on any exclusion list, a
small bounded change to one route.

## Every source claim held. The conclusion did not.

Verified against `main` before writing anything, as the standing rule requires:

- `app/api/body-battery/route.ts:94` really is `export async function GET()` — no parameters. ✅
- `grep '^### .*LB-102'` really returns nothing. ✅
- The buckets really are persisted, and `stress-day-chart.tsx` really takes a plain array. ✅

All true. And the conclusion drawn from them — *therefore TN-3b is blocked and nobody will pick this
up* — is wrong, because **the work shipped on 2026-09-13 under a different path**.
`app/api/body-battery/stress-day/route.ts` serves the stored buckets for any day, takes `?date=` with
both separators, and `components/body-battery/stress-day-chart.tsx:78` fetches it — rendered from
`app/health/day/day-detail-content.tsx:260` with `date={selectedDate}`.

**LB-102 was never untracked. It was done**, which is why it left the backlog — the route and its
test both still carry its name (`lb102-stress-day-read.test.ts`). The entry searched the backlog for
the dependency and concluded from its absence that nobody would do it; absence from a queue that
removes completed entries is the signature of *finished*, not of *lost*.

## The route that shipped it rejects LB-110's design by name

Not a near-miss — a recorded decision:

> *"A sibling route rather than a `?date=` on the battery route, and the reason is not tidiness. The
> battery response is a live model anchored to `now` — the HR walk, the reserve, the label — and none
> of it can be computed for a finished day. A parameter that changed the response's SHAPE is the kind
> of thing that reads as one endpoint and behaves as two."*

So LB-110 is removed with the reasoning attached, rather than implemented to clear the queue. TN-3b's
`Keep:` now points at the shipped route instead of at a third successive phantom dependency.

## Two live hazards found before the duplicate surfaced, kept

The implementation was most of the way done when the sibling route turned up. Two findings are facts
about the live route rather than about the entry, so they are recorded on the removal note:

**`/api/body-battery` has two write side-effects on a GET.** It upserts the day's
`body_battery_daily` snapshot, and it calls `buildReadinessPayload(userId, tz)` — which takes no date
and persists **today**. Anyone who ever does date that route must make a dated read strictly
read-only: the snapshot is the *accumulated* end-of-day record (its own comment says so), and its
`hrMaxObserved` feeds `resolveBatteryHrMax` across the peak window, so a retrospective write would
propagate forward into later days' batteries.

**The entry's scope line named the wrong helper.** It said to normalise with `normalizeDateParam`,
which returns the **slash** form, in a route that is dash-keyed throughout. That is the J-8/J-9
silent-feature-death shape, and following the entry literally would have produced a route that
returned empty days without erroring.

## What is NOT done

No code. The route is untouched — `git checkout --` restored it, and the diff is markdown only.

## Failure surfaces NOT exercised

Docs only; nothing runs. `pnpm ci:local` green.
