# 2026-09-24 — DV-14 recurred, and it makes DV-13's answer uncertain

**Branch:** `lane-a/dv14-remeasure` · **Lane A** · docs only. Nothing here is fixable from a
container — see Blocked.

## The measurement

| | |
|---|---|
| live `/api/version` | **1.465.17** |
| `main`'s `package.json` | **1.465.22** |
| when 1.465.17 landed | **#1473, 20:36 AEST 09-23** |
| stall so far | **~10 hours** |

Five merges are unshipped: #1474 (post-push guard), #1477 (nutrition chunk nesting), #1478 (route
animations), #1479 (More sub-tabs crossfade), #1481 (Home's APK banner). Every one is user-visible.

DV-14 was filed at 20:25 AEST against a two-hour stall and updated twenty minutes later to say
production had **caught up by itself**. It had — and then stalled again, for five times as long.
Its own note is the one that held: *something that stopped is not something that was fixed.*

## Why the shape matters

It is not one stuck deploy. Stall → catch-up → stall means something is batching, throttling, or
succeeding intermittently. A deploy that simply failed would stay failed, and a disabled one would
never have produced the 20:27 catch-up.

## This corrects DV-13, which was mine

DV-13's conclusion — written earlier today — was that the 8-minute outage at 20:04 came from the
production deploy triggered by the 20:03 merge, 70 seconds earlier. **That reasoning assumed a merge
deploys promptly.** DV-14 measured that it did not: at 20:22 production was still serving
**1.465.10** while `main` was at **1.465.16**, so #1468 had almost certainly not deployed by 20:04.

What survives: the outage is still deploy-shaped — a database-free route unreachable for minutes and
then instantly healthy is a container being replaced, and the only two errors in the window are
connection-acquisition failures at the moment of recovery. What does not survive: **which** deploy,
and the 70-second correlation that made it feel settled. A batched catch-up of several queued merges
fits the same evidence.

The merge-cadence conclusion is unaffected — several merges in a few minutes is several restarts
whenever they land — so the advice stands while the attribution behind it does not. Corrected on
DV-13, on DV-14, and in the `projectOverview.md` row the owner reads.

**This is the second time today I stated a cause more confidently than the evidence carried**, the
first being LA-130's "one unshallow immunises the clone", measured on clones that never ran the gate
that was actually causing it. Both had a correlation and a plausible mechanism and no test that
would have failed if they were wrong.

## Blocked

**Railway's deploy log for `main` from 18:16 is the first step and is not reachable from here** —
no Railway API or CLI in the sandbox. Nobody in a container can take DV-14 further; it needs the
owner or the device agent's machine. Everything else in the entry is downstream of that read.

## Not done

- **No fix, and none is available from here.** The entry's own lane note says this is Railway's
  deploy for `main`, not application code.
- **Failure surfaces not exercised:** the device. `/api/version` was read from the sandbox only, so
  what the APK reports after a restart is unconfirmed — and that is exactly the check DV-14's pass
  test needs.
