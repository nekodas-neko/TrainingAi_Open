# Review — this run's fourteen findings, checked against production

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** verification of my own claims
**Findings filed:** none new · **Q-475 upgraded with production evidence · four re-priced**

## Why

Sweep 8 checked that run's findings against production and **corrected four of them**. Fourteen more
(Q-473…Q-486) have been filed since, none production-checked. A finding priced on a reachability
guess is a finding priced wrong.

**The standing constraint, restated because every number below depends on it:** `claude_ro` is
**row-scoped to one user** and `error_events` prunes at **30 days**. Every count is *the owner's,
recently* — never "the system's".

---

## Q-475 — upgraded from "measured locally" to "the production evidence is the absence"

The finding: a database outage reaches the sync client as HTTP 200, so the client's 5xx backoff never
engages and every queued mutation burns its dead-letter budget. Measured locally by stopping Postgres.

Production says something stronger than I expected:

| Route | Faults in `error_events` | Span |
|---|---|---|
| `/api/sync/pull` | **69** | 2026-07-19 → 2026-08-13 |
| `/api/sync/push` | **0** | — none, ever |

And connection failures are not hypothetical here — `timeout exceeded` / `ECONNREFUSED` /
`Connection terminated` signatures, by day:

```
2026-08-17   1        2026-08-11  20
2026-08-13  16        2026-08-10  16
2026-08-12  39        2026-08-09  33      (125 across six days)
```

One of the `/api/sync/pull` rows is explicitly `[cause: timeout exceeded when trying to connect]
Failed query: select …`.

**Why the zero is evidence rather than an absence of traffic.** `components/sync-provider.tsx` runs
both halves in one cycle, **push first**:

```ts
:139   try { await pushMutations(userId); } catch { /* network unavailable */ }
:145   const delta = await pullDelta(userId);
```

(and `:194`/`:195` fire both together). Push executes immediately *before* pull on every sync. Over a
period in which pull recorded 69 faults and the database refused connections 125 times, push recorded
none. Push is not less exposed than pull — it runs first.

So the zero is not "push never failed". It is "**push cannot report**", which is precisely what Q-475
says: `pushMutations` catches per-mutation, returns 200 with the failure inside the body, and never
calls `reportServerError`. The one place designed to catch faults that never reach a human has a
blind spot exactly where this finding lives.

**This does not change the fix**, but it does change the priority argument: the precondition has
occurred in production, repeatedly, within the last ten days of data.

---

## Q-482 / Q-483 — reachability confirmed as zero, and that is worth recording

A malformed route id producing `22P02 invalid_text_representation`:

```
SELECT … FROM claude_ro.error_events WHERE message LIKE '%22P02%'   →  0 rows
```

**It has never happened in production** (owner's rows, retained window). That matches how both were
filed — Q-482 explicitly *"not a security hole"*, Q-483 as authenticated-only disclosure — and it
should stop either being re-priced upward by someone reading only the 500s. The SQL-leaking response
of Q-483 has, on this evidence, never been served to anyone.

---

## Q-484 — latent confirmed, more so than expected

```
claude_ro.injuries      →  0 rows          (max notes / muscle_name: null)
claude_ro.supplements   →  2 rows, max name 9 chars, max dose 10
```

The `injuries` table is **empty** for the owner. So the route that accepts a 10 MB note has not stored
anything at all, and the sibling that also lacks a schema holds two short rows. Filed as low severity;
production supports that reading.

---

## Q-481 — no evidence either way, and the data is too thin to produce any

```
claude_ro.body_metrics: 4 days with water_ml, max 1000 ml, 0 days over 6 L
```

No double-count signature — and with four days of data and a 1 L maximum, **there is not enough water
logging for one to appear**. Do not read this as the replay not happening; read it as the feature
barely being used. Q-481 stands on its local measurement.

---

## Q-485 — production cannot adjudicate it, and the tempting number is a trap

```
claude_ro.body_metrics: 35 of 114 rows have steps but a NULL weight
```

**That is not evidence of coerced-away weights and must not be cited as such.** It is the expected
shape: steps arrive daily from the ring / Health Connect, weight only when the owner stands on a
scale. A null weight beside steps is the normal case, not a dropped field.

This is the same trap as sweep 8's Q-460 (*"74% of completed sessions lack an RPE"* — consistent with
both a dropped write and a skipped optional prompt). Recording it here so the next reader does not
pick the number up as support.

---

## What this sweep changed

| Finding | Before | After |
|---|---|---|
| **Q-475** | measured locally | **precondition confirmed in production, 125 connection failures / 6 days; push's silence is visible as a zero against pull's 69** |
| **Q-482, Q-483** | filed low / not-a-hole | **confirmed never triggered in production** — do not re-price upward |
| **Q-484** | filed low | **latent confirmed** — the target table is empty |
| **Q-481** | measured locally | **unprovable from production** — the feature is barely used |
| **Q-485** | measured locally | **unprovable from production** — and the obvious query is a trap |

Nothing new was filed. Five entries were amended to carry these results.

## Not verified

Everything above is the **owner's** rows within the retained window. A zero means the owner never hit
it, never that no user did — production holds other accounts this endpoint structurally cannot see.
Push *traffic volume* could not be measured directly; the argument that push runs is from
`sync-provider.tsx` calling it before pull in the same cycle, not from a counter.
