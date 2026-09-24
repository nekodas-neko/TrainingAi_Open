# 2026-09-24 — the first thing tonight to pass a validation, and it turns the nulls into a measured ceiling

**Branch:** `tuning/rpe-residual-validated` · **Agent:** Tuning · **Docs-only.**

Five attempts to validate the scores against something external had failed — contaminated, circular or
empty. Before using TN-65's RPE residual again, the obvious question was whether the instrument detects
anything at all. It does.

## The positive control TN-65 never ran

Within-session fatigue is the known effect: later sets of the same exercise at the same load should feel
harder. Residual = RPE minus the mean for that exercise at that planned-intensity band.

| set | n | mean residual |
|---:|---:|---:|
| 1 | 303 | **−0.094** |
| 2 | 253 | −0.021 |
| 3 | 145 | **+0.154** |
| 4 | 80 | +0.129 |

`corr(set_number, residual)` = **+0.156 over 782 sets** (p ≈ 1×10⁻⁵). **The residual beats raw RPE** at
this — raw gives +0.148 — so removing the load effect *strengthens* the fatigue signal. That is the
evidence the correction does real work.

**The raw comparison alone would have been a false positive:** mean RPE rises 7.30 → 7.84 across sets
1→4, but mean planned intensity rises 73.0% → 77.8% too, so part of the raw rise is just heavier sets.

**So the instrument's sensitivity is known: about 0.25 RPE points** (set 1 → set 3). That figure is what
makes the nulls mean something.

## The scores against it — matched exercise, load band AND set number, 527 sets

| | corr with residual | poor | good | difference |
|---|---:|---:|---:|---:|
| `sleep_score` | **+0.001** | −0.113 (<50, n=98) | −0.068 (≥70, n=342) | **0.045**, wrong sign |
| `readiness_score` | −0.053 | — | — | ~0.04 |

The instrument sees **0.25**; neither score moves perceived effort by a fifth of that, and the
sleep-score difference points the wrong way. **Doing one more set at the same load changes how hard
training feels roughly five times more than the gap between the app's best and worst sleep nights.**

## What it does not license

This is about **perceived effort during training** — one narrow outcome. The scores may predict things
it cannot see (injury risk, adaptation, mood, illness), and RPE is self-reported with sd 0.94. The entry
says outright: do not write "the readiness score is meaningless" on the strength of this. Write *it does
not predict how a session will feel, by a measured margin.*

## What changes for calibration work

Future scoring proposals now have an acceptance test with a floor: **move the residual, and the bar is
0.25.** A calibration that shifts it by 0.04 has been shown to sit below the instrument's resolution.
That is stronger than the distributional tests the scoring work has used, which only compare a score to
itself.

Filed **TN-73** with a `Reference:` field — and this is the field used *correctly*, in contrast to
TN-56, TN-59, TN-63 and TN-64 where I wrote it meaning "background reading" and filed buildable work as
read-only. Those entries had work in them; this one has a standard in it.

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**. **Not established:** that
`oura_daily_derived.day` keys the sleep score to the night *ending* that morning — assumed, not checked
against the sleep-session boundary. And the 527 sets come from ~40 training days, so sets within a day
are correlated: the set-level n overstates independent observations, inflating confidence in the
correlations while leaving the group means (the 0.045) sound. Both are on the entry. `pnpm check:rules`
result below.
