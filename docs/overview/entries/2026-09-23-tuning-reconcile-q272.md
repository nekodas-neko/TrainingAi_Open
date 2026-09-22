# 2026-09-23 — TN-55 was Q-272's missing proposal, and Q-272's acceptance test does not replicate

**Branch:** `tuning/reconcile-q272-and-file-lanes` · **Agent:** Tuning · **Docs-only.**

Asked to file what was buildable into the lanes and route owner-input items to the Orchestrator. The
first thing the sweep turned up was a duplicate of my own making, which was worth more than the filing.

## TN-55 never checked for an existing entry

**Q-272 — *"Body Battery v5 drains 5× faster than it charges"*, filed 2026-08-15** — is the
pre-existing entry for the defect TN-55 describes. It says in its own text that *"the next action is
Tuning's, not theirs"* and that **no proposal exists**; it had been waiting a month. TN-55 is that
proposal and I filed it without looking. The two are now linked and Q-272's gate is lifted.

Reading it changed the recommendation twice.

## Overnight charging is out, and the fit is better without it

Q-272 argues that *"overnight recharge here is handled by the morning anchor reset rather than
accumulated charge, which is a defensible difference"*. That is right, and my proposed
`SLEEP_CHARGE_RATE` would have counted the night twice — against an anchor already derived from
readiness and sleep. It showed in my own numbers as 13–14% of days pinned at 100 and I read it as a
tuning problem rather than a double-count.

Re-fitted with no overnight term, strictly better on every axis:

| | shipped | first proposal | **revised** |
|---|---:|---:|---:|
| median daily net | −85.1 | −0.2 | **+0.5** |
| mean end value | 14.8 | 59.2 | **61.4** |
| sd of end value | 26.4 | 28.0 | **25.3** |
| days ending at 0 | 66% | 5% | **0%** |
| days pinned at 100 | 0% | 8% | **9%** |

Revised constants: `CHARGE_RATE` **0.120**, `DRAIN_RATE` **0.080**, `STRESS_DRAIN_RATE` **0.020**, no
overnight term, `REST_THRESHOLD` unchanged. Gain 0.30 takes railing to 6% if the pinning shows in use.

## Q-272's acceptance test does not replicate, and it was about to sign off the change

Q-272 records **r = +0.67 (n = 11)** for end-of-day battery against next-day readiness, and instructs a
later session to re-run it after the change. Re-measured over **70 days**: **r = +0.252** — against
readiness's own day-to-day autocorrelation of **+0.361**, which is higher. The battery's end value
predicts tomorrow's readiness *worse than yesterday's readiness does*.

So the conclusion built on it — *"v5's level carries real signal; its shape within the day is wrong"* —
keeps its second half, because the four defects are independently measured, and **loses its first**.
The distributional pass test stands; a change cannot be validated against a relationship that is not
there. Both entries now say so.

## Q-502 and TN-55 disagreed about the lever; both were right about different things

Q-502 refuted raising `CHARGE_RATE` alone — the window is active on ~6.7% of waking samples — and
concluded `REST_THRESHOLD` is therefore the lever. The refutation stands and this plan does not raise
`CHARGE_RATE`. The conclusion goes further than the evidence: widening the threshold to TN-52's p10
quantile buys 2.8% → 3.7% of the day. The window is barely active for a different reason than its
width — sleep is excluded and the ramp zeroes at the ceiling — so flattening the ramp makes the
*existing* window productive, which is what Q-502 was reaching for.

## One caveat the plan cannot settle

`DRAIN_RATE` falls 7.5×. Q-521 already measured that drain tracks **wear time** rather than exertion
(`corr(hr_sample_count, drained)` **+0.518** vs `corr(steps, drained)` **−0.153**), so weakening it
could make a hard session even less visible. The plan tells Lane A to confirm a workout day still
separates from a rest day — and that if it does not, that is a *separate* defect (drain keyed on the
wrong input), not a reason to raise `DRAIN_RATE` back and restore the countdown.

## Filed for the lanes

**TN-61 (Lane O, now its READY #1)** — `next-item.js` prints ten rows of a thirty-one-row bucket and
says nothing about the rest. Two entries I had just edited appeared nowhere in its output, which reads
exactly like *removed from the queue*. One line of output, not a behaviour change; the cap is right,
the invisible truncation is not.

## Routed to the Orchestrator's ledger (LA-122), needing the owner

- **2b — is a contributor worth 2.8% of readiness's movement worth keeping?** `activityBalance` carries
  2.8% on a 0.06 weight; the two activity terms together are 7.4% of the number on 15% of the weight.
  Keep, re-weight or drop — each re-scores history. **Deliberately not asked yet:** the rail fix
  (TN-60) will move the table, so asking now would answer a question whose numbers are about to change.
- **2c — the `.size` conflict tax, now measured.** Five of seven PRs this session hit a baseline
  conflict, two also needing the append-only history file resolved by hand. Item 5's cheapest fix does
  not help, because the conflicts came from *other agents'* PRs landing between mine; the one that does
  is generating baselines in CI, which changes the ratchet and needs the owner's yes.

## Not exercised

Nothing runs. The re-measurements are read-only queries through `/api/admin/db-query`, **row-scoped to
the owner**, and the re-fit used the committed harness on data already pulled. **Not established:**
whether the revised constants keep a workout day distinguishable from a rest day — flagged in the plan
as Lane A's check, not asserted here. `pnpm check:rules` **Ran 75 of 75**, all passed; backlog validates
at 417 entries.
