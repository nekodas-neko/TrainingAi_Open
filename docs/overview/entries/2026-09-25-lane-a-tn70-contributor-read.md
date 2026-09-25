# TN-70 — the contributor read, and the dead column it ran into

**Branch:** `lane-a/tn70-baseline-read` · Lane A · **docs only**, no code. TN-70 stays queued; this
is its cheap next step done, not the entry closed.

## Why a read instead of the replay the entry asked for

TN-70 prescribes re-running the rollup over the level-5 span. That is not doable from a container —
**191,191** raw frames plus 1,508 packed against a `db-query` capped near 1,000 rows per call, and a
~40-member `io` no test in the repo constructs. The entry now says so, and says what would unblock
it (a production-side replay, or a database restore).

The cheaper route was already implied by this entry's own earlier finding: the regime switch is
carried by `resilience_daily_sleep_recovery`, and **its contributor inputs are stored**. So "were
the July scores wrong" is a read.

## One hypothesis killed

**The baseline was not still learning in July.** `BASELINE_MIN_NIGHTS` is 14 and **0 of 68 days** in
the span were under it — the level-5 run carried 18–54 nights of history, September 63–81. That is
the obvious explanation for a young-baseline artefact and it is now closed. Recorded on the entry so
nobody spends an afternoon on it.

## One asymmetry measured

| regime | n | RHR raw | RHR score | sleep score |
|---|---:|---:|---:|---:|
| Jul 24 – Aug 29 (level 5) | 37 | 52.7 bpm | 63.9 | 79.1 |
| Sep 7 – Sep 25 (levels 1–4) | 27 | 54.8 bpm | 40.3 | 53.7 |

**Resting heart rate moved about 4% while its score moved 37%.** A small real change is being
amplified several-fold. That is consistent with a baseline re-centering as history triples, and it
is **not established as the cause** — "the owner genuinely got worse" and "the scale moved under
him" are both still live. What the read does is point at the raw series as where to separate them.

I am stating that carefully on purpose. Three times this session I formed a confident conclusion
from a suggestive measurement and had to retract it. A 4%-versus-37% gap is a reason to look at the
scoring curve, not a finding about it.

## The column that should have answered the other half

The same comparison for HRV was impossible: **`night_hrv_baseline_ms` is NULL on all 130 rows**.
Filed as **LA-140**. The plumbing is complete — schema, `DERIVED_COLS`, row mapper, push branch,
local SQLite, sync delta — and nothing writes it; `run.ts:1170` is the *input* to
`computeResilienceForDay`, not a persist.

It changes no behaviour, because the compute uses the in-memory value. The cost is diagnostic, and
it caught me: `computeResilienceForDay` gates `contributorsOk` on that field being non-null and
falls back to a fabricated `50` for the stress scaling, so seeing NULL in the table invites exactly
the wrong inference. I drew it myself before checking the producer. A column that is always null,
sitting beside a guard that tests for null, is a trap for the next reader.

## Verification

Custom Rules **78 of 78**. No code changed, so no tests were added — every figure above is a
production read through `claude_ro`, which is **row-scoped to the owner**, so all of it is the
owner's days only.

## Not done

**TN-70 is not closed.** Whether the 16 level-5 days were ever correct is still open, and the next
move is the raw series behind the contributor scores rather than another aggregate.

**LA-140 is filed, not fixed** — persist-or-delete is a real choice and the entry states both sides.
