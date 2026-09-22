# 2026-09-22 — four owner decisions recorded, and three gates lifted

**Branch:** `tuning/record-four-owner-decisions` · **Agent:** Tuning · **Docs-only.**

The owner asked for the open questions as a prompt with recommendations. All four came back as
recommended. Recorded here and on their entries, because the whole reason LA-122 exists is that a
decision living only in a chat transcript dies with the session.

## The decisions

**1. The readiness history is re-derived ONCE, not per change.** Four entries each rewrite stored
readiness days — TN-60 (the rail), TN-6 and BF-13 (the temperature baseline), LA-121. Shipped
separately his history would visibly shift four times over a few weeks with no way to attribute any
change to the fix that caused it. So the code lands in normal separate PRs and
`POST /api/admin/rederive-baselines` fires **once**, after the last of them, dry-run first.

Recorded as LA-122 item **2a**, deliberately **not** as a `Batch:` field: `Batch:` means one PR, and
one PR here would bundle three code changes with an owner-fired production data write, which the
standing rules forbid batching. The shared thing is the recompute run, not the diff. Whoever ships the
last of the four says in its PR that the recompute is now owed.

**2. TN-60 — build the compressive tail.** Keep the linear region as it is; replace the hard clip at
±1.5σ with a curve that keeps compressing, so the 38% of days currently pinned at a rail keep their
ordering instead of collapsing onto 0/100. Gate lifted; it is now Lane A's READY #1. The
per-contributor-quantile option is recorded as considered and not chosen.

**3. TN-55 — ship the Body Battery structure now, re-sweep after 2026-10-04.** He accepted two
re-scores as the price of not leaving the battery a countdown for another fortnight. The four
structural changes take days-ending-at-zero from 66% to about 5% and do not depend on the exact
constants. **This is not in the batch above** — it writes `body_battery_daily`, a different table.

**4. LA-121 — do not port the temperature ladder; let `tempZ` stand.** The reason is the part worth
keeping: TN-6 has measured the temperature baseline **0.36 °C too low**, so porting the *sharper*
penalty on top of a wrong baseline amplifies the error rather than adding signal. Temperature already
reaches readiness through `computeReadinessComposite`. If it looks under-weighted after TN-6's rebuild
lands, that becomes a fresh question with data behind it.

LA-122 item 2 is struck as answered; its `Keep:` stands for the remaining items.

## What this changes in the queue

Three gates lifted — TN-60, TN-55 and LA-121 all carry no blocking field now and all three are
startable. LA-121's remaining work should be **behaviour-preserving** dead-code removal (the four dead
branches keep the fallback arm that already runs; the fifth site's dead disjunct simplifies away), and
the entry says Lane A confirms that rather than assuming it — if it does move a stored value it joins
the batched recompute instead of firing its own.

## Noted while checking

`next-item.js` prints only the top 10 of a bucket without `--all`, and lane A's READY is now 31. Two
entries I had just edited appeared nowhere in the output, which reads exactly like "removed from the
queue" until you check the fields directly. Worth knowing before concluding an entry has vanished.

Also seen landing from other lanes: **LA-128**, the check-in route stripping an unknown key instead of
rejecting it — the `.strict()` defect LB-124 found, now its own entry. That is the one that would have
burned TN-58's two-week pass test.

## Not exercised

Nothing runs; this records decisions and lifts gates. No measurement was taken today beyond confirming
which entries carry a recompute — the four decisions rest on measurements already filed
(`hrvBalance` railing on 38% of days, the battery's −29.8/day net, the 0.36 °C baseline offset).
`pnpm check:rules` **Ran 75 of 75**, all passed; backlog validates at 398 entries.
