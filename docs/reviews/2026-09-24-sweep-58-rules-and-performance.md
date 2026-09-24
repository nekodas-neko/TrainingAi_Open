# Review sweep 58 — the rules no check enforces, and where the time goes

**2026-09-24 · Review · docs only.** The owner asked for three things: send the decisions to the
Orchestrator, do another sweep, and do a performance and efficiency sweep with the device agent's
help. Six read-only agents ran: three on rules, three on performance. This session re-checked the
high-stakes findings in code and production. The bundle agent stopped early on a usage limit after
its build had finished, so its analysis was completed here from the build output.

## Decisions → Orchestrator

They were already there. Lane O opens with OR-150 (the Orchestrator's own), then **RV-161, RV-157
and RV-170**. No Orchestrator session was running, so the queue is the channel. This sweep raises no
new owner question; RV-179 is a Lane O call on which checks to widen.

## Part 1 — a census of the CLAUDE.md rules no CI step enforces

| finding | lane | severity |
|---|---|---|
| **RV-171** — a failed load in the meal-plan setup, then Generate, **deletes every saved dietary restriction** | B | **high** |
| **RV-172** — the sync pull omits columns the device then nulls: supplement ticks lose their time and frozen vial dose (LA-97's rewrite, one layer up); plus exercise-log deload and food-item order | A | **high** |
| **RV-173** — Coach streams prose without PROSE_GUARDS, and the test's hand-written list misses it | A | medium |
| **RV-174** — deleted programs and styles never leave the device mirror | A | low–medium |
| **RV-175** — offline edits or deletes of logged training are lost after a success toast | A+B | medium–low |
| **RV-176** — `todayInTz(DEFAULT_TZ)` on the score detail screens, plus latent device-clock sites | B | medium / low |
| **RV-177** — nine low route-hygiene gaps | A | low |
| **RV-178** — client gaps: a card that vanishes, two unguarded buttons, three small fetches | B | low |
| **RV-179** — five CI checks with blind spots the census walked through; a stale CLAUDE.md count | O | process |

**CLEAN, so the next sweep can skip these:**
- auth on all 297 handlers, admin gating, Zod on every ingest route, try-catch on every AI call,
  fail-closed secrets;
- affected-row checks before child writes, webhook ordering, raw bodies never reaching `.set()`;
- floored safe-area utilities on bottom rows, and write callbacks that carry the entity.

## Part 2 — performance and efficiency

**Server side, from `pg_stat_statements`** (readable, 25.2 days, 1,083 s of DB time), the code, and
`next build`:

| finding | lane | cost |
|---|---|---|
| **RV-180** — `resolveDsToMs` re-sorts 12,396 anchors per call, called per row. **The likely cause of DV-13's 8-minute outage** | A | 3.0 ms/call; ~177 s for device-metrics' default window |
| **RV-181** — the HR profile pulls 90 days of raw HR for three statistics | A | **51.5% of all DB time**; 209 M rows returned |
| **RV-182** — a no-op UPDATE on every ingest; the anchor table read whole and ever-growing; HR delete/reinsert churn | A | 86 s + 104 s of DB time; 1.0 B sequential tuple reads |
| **RV-183** — 6 GETs on every resume, a wasted refetch round after every food log, the exercise catalogue refetched on every Workout show | B (+A) | 2N+1 where N+1 would do |
| **RV-184** — prescription regenerated at open on 8 of 20 workout days | A | ~2.1 s of waiting |
| **RV-185** — 457 kB of first-load JS per tab (506 kB on Workout); framer-motion and zod eager | B | measure first |

**The device half is RV-186**: one sitting, run **before** the fixes, so each fix has a recorded
"before". It covers:
- request counts at launch, resume, tab switch and food log;
- server wait for the endpoints above;
- HR-profile requests during a real workout;
- idle requests per hour;
- DV-13's pass test, **but only after RV-180 ships**.

It folds in DV-12, RV-153, RV-145 and BF-22 where the screen is shared.

**Checked and fine:**
- all three `oura_raw_samples` indexes are used, so the 45 MB is bloat (Q-540);
- the cache hit rate is 99.9%, with 0 idle-in-transaction connections;
- the warm routes have no N+1 queries;
- 0 AI failures in 30 days;
- there is no periodic sync timer.

**A false lead, recorded:** the build's module list shows `@sentry/conventions` at 499 KB. That is
source size before tree-shaking; the shipped chunk is **657 bytes**.
