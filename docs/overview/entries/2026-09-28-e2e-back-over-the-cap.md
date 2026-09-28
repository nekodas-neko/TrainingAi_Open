# 2026-09-28 — LB-166: E2E is back over its cap, and this lane spent the margin

**Lane B.** Branch `docs/e2e-over-cap-again`. Docs only — no code, no version bump.

## The measurement

Two consecutive E2E runs hit the 45-minute job limit:

| run | head | duration | result |
|---|---|---:|---|
| `36456542521` | #1926 | **46m41s** | `cancelled` |
| `36458784138` | #1927 | **45m17s** | `cancelled` |

Against the three censuses taken earlier the same day — **35.5 / 36.3 / 36.6 min** — that is a
**~9–10 minute regression inside one day**.

## ⛔ Why it is worse than a slow job

**A run killed at the cap uploads no artifact.** Run `36458784138` has **zero**. The cancel lands
before the upload step, so the `playwright-report` that holds the retained **first attempt** of every
flaky test — the method `LB-178` now depends on entirely, and the thing that root-caused `tn53` and
found `LB-184` — does not exist for a capped run.

So E2E has gone from *advisory* to **no signal**: no pass/fail worth reading, and no evidence to read
afterwards. The census that would measure `LB-184`'s effect cannot be taken until this is fixed.

## Where the time went, and it is mostly mine

This lane added **four spec files** on 2026-09-28: `lb163-log-tiles-three-column` (1 test),
`la136-home-sleep-feel-line` (2), `tn82-checkin-announce-and-correct` (3),
`rv119-home-banner-strip` (1). Seven tests, each driving a full Home load, measured locally at
roughly **1.2–1.6 min per file**. That accounts for most of the regression.

**Each is justified on its own entry, and that is the point.** Nothing weighs them together. The
suite has no budget line, so no single decision was wrong and the ceiling was crossed anyway.

`LB-178` dates the margin precisely: *"at 36.3 min the suite finished UNDER the 45-minute cap, where
it had been hitting it. Six specs that each burned a timeout before failing were most of the
difference, so clearing `LA-176` bought back roughly the margin the cap was eating."* That margin was
about nine minutes wide, and it is gone.

## The recommendation on the entry

**Shard E2E the way `Tests` is already sharded** — four jobs and a rollup — rather than raising the
cap, which buys a few more months of the same. Sharding also makes a capped run *impossible* rather
than merely less likely, which is what protects the artifact.

Whichever is chosen, **a per-PR check on total E2E wall-clock belongs with it**, or this recurs
silently: the tell is a `cancelled` that ran ~45 minutes, and that is indistinguishable from the
harmless superseded-push kind without reading the duration.

## Not exercised

**Nothing is fixed here.** `LB-166` is parked on `LB-149`, and the fix is a CI-workflow change; this
records the measurement so the entry is worked from figures rather than from the 2026-09-27 ones,
which no longer describe the suite. The attribution to this session's four specs is **arithmetic on
local timings**, not a measured per-spec breakdown on CI — a capped run publishes no report to break
it down with, which is the same problem one level up.
