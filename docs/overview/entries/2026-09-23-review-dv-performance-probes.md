# 2026-09-23 — the performance half of the device-agent brief

**PR:** this branch. **Docs-only.** Nothing was run on a device.

## What prompted it

The owner asked whether the Device Verification agent had been given a sweep of the checks it can
*really* test — page-load efficiency, timing, path structure. **It had not.** Of the ten probes filed
in #1418, only P6 (warm-visit paint) and P10 (heap and listener accumulation) touched timing; the
other eight are correctness — invalidation reachability, the local store, offline, computed styles.
That is a real gap and the answer was "no", not "partly".

## Why it is worth filing rather than just running

The repo already has a perf thread, and it is **stalled on exactly this measurement**:

- **Q-51** softened to the owner's *"Its mostly fine; I'd still like it to be faster if possible"*,
  and its own conclusion is that *"measure before refactoring" is now **more** binding, not less* —
  a large refactor is a poor trade against "mostly fine".
- **The whole queue's perf evidence is one observation**: `/workout` visited five times in a session,
  four at ~100 ms and one at **1086 ms**, all warm. Read as a first-mount cost. The remaining
  file-splitting work rests on that reading.
- **BF-22** is an owner report already narrowed to in-memory client state — *"everything is loading
  very slowly"*, then *"actually its running a lot better after a force restart"* — with the
  server-distance theory measured and found wrong.
- **RV-110** counts 37 cross-tab `router.push` sites that tear down the tab shell, and has **no
  number for what a teardown costs.**

So each entry is aimed at an open question that already exists, rather than at producing a fresh pile
of numbers nobody asked for.

## The six

| | probe | what it settles |
|---|---|---|
| **RV-137** | P11 — cold start + per-tab TTI | gives the perf thread its first baseline; Q-51 and Q-147 both closed on impressions |
| **RV-138** | P12 — the 1086 ms outlier as a distribution | whether Q-51's file-splitting work is justified or the reading was noise |
| **RV-139** | P13 — network waterfall, chain depth | serial request chains, which no source-reading sweep can see |
| **RV-140** | P14 — main-thread long tasks | RV-113's asserted cost; and whether `animationiteration` still takes 21.3% |
| **RV-141** | P15 — path structure | RV-110's missing cost-per-teardown |
| **RV-142** | P16 — does a long session slow down | the timing half of RV-133; together they decide BF-22 |

**Cold start is measurable now and was not before**, which is why this did not exist. A recording
cannot span an app kill — the WebView dies with it. But `performance.getEntriesByType('navigation')`
and `('paint')` survive for the life of the page, so a harness that attaches *after* a normal cold
start loses nothing. `device-perf-profiling-checklist.md` had already worked that out and had no
agent to run it.

## Routing, checked rather than assumed

6 of 6 reach `next-item.js --sittings`; **0 leak into either implementer lane's READY list.** Same
`Verify: device` filing as RV-124…RV-133, with each entry stating in its first bullet that there is
no build half — these are measurements, not shipped work awaiting a look.

## Not established

Nothing was run. Every threshold in the entries (300 ms warm, 1.5 s FCP, 50 ms long task, chain depth
2, 20% drift over a session) is a **stated expectation to be falsified**, not a measured budget — the
app has never had one. A probe that comes back green against these is as useful as one that fails,
because it is the first baseline either way.

## A fifth datapoint for RV-134, collected by accident

This PR conflicted on `docs/doc-size/docs/implementation-backlog.md.size` and the append-only
history file — **five of five merges tonight**, after RV-134 recorded four of four and Tuning
recorded five of seven. That entry argues the mechanism is the ratchet's missing `inherited` escape
on the *slack* direction, and this merge is another instance: `main` had shrunk the backlog below
the number on this branch, so the branch was required to lower a figure it never moved.

Not re-filed — RV-134 already holds it. Recorded here because the count is the evidence, and a PR
that demonstrates the defect it is not even about is worth one line.
