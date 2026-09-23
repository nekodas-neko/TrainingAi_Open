# 2026-09-23 — Sweep 1 prepared: the performance probes built, every owed device check read

**Branch:** `device/sweep-prep` · **Agent:** Device Verification · **Docs + `scripts/device/**`.** The
phone was unplugged throughout; nothing here touched it.

The owner asked for everything needed to run one large sweep, and to wait for his go-ahead.

## The plan — `docs/device-sweep-1-plan.md`

Every one of the **116** entries `next-item.js --sittings` lists was read against its backlog text
and bucketed by what the sitting can actually settle: **53 automatable, 9 pre-approved writes, 9
writes needing the owner, 18 hardware, 6 owner judgement, 21 not really device checks** (a diff
against the runner's list: none missing, none extra). Plus Review's Part B, P11–P16. Ordered into
ten blocks, about three hours, with the owner-present block optional.

**Two writes are riskier than "approved" suggested**, and the plan asks rather than assumes: a manual
weigh-in **overwrites the day's real weight** and outranks the scale afterwards, and a mood check-in
is one per day, so a test would overwrite the owner's real answers if he has already checked in.

Found while building it, recorded in the plan for the Orchestrator: BF-107 and LA-57 still print as
owed though one is closed and one refuted; BF-95's failure note reads like BF-61's symptom; BF-99's
line lives in `calorie-zone-bar.tsx`; BF-139/BF-96 would only repeat a failure nothing has fixed.

## The tooling — `scripts/device/perf.js`

`coldstart` (navigation and paint entries after a real cold start, then each tab's first visit),
`tti`, `cycles` (the full list of mount durations per route, never a mean — RV-138 decides Q-51 on
it), `longtasks` (long tasks plus long-animation-frame script attribution, for the old
`animationiteration` finding) and `backstack` (guarded; stops at Home). Every visit is measured the
same way — ms to content (no loading block, real text) and to settled (no `/api` in flight for
400 ms) — and carries its request waterfall and long tasks, so an outlier can be read as network,
thread, both or neither.

**One thing the self-test caught before the phone could:** the serial-chain detector compared a
request's start with the previous one's *load end*, but `fetch` resolves on headers, so a chained
request starts before the body finishes and the chain was invisible. It now chains on
response-received. `selftest.js`: **22 of 22**.

`pw.js` also gained request timings and bytes, and **`back()` now refuses when the app is not in the
foreground** — KEYCODE_BACK goes to whichever app holds the screen, the same hazard as sitting 2's
blind taps.

## Not exercised

All of it on the phone. `perf.js` has only run against the desktop fixture.
