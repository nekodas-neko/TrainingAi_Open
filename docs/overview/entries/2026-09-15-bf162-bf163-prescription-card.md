# 2026-09-15 — BF-162 and BF-163: two defects on one prescription row (BugFix intake)

Docs-only. The owner, reading his Legs prescription: *"Is this right? Is hypertrogpy the correct
tag?"* Two separate answers.

## BF-162 — 85 kg on a Hanging Leg Raise

Reproduced exactly from his stored values; this is arithmetic, not an anomaly.

| exercise | stored `estimated_1rm` | × pct | card shows |
|---|---|---|---|
| Hanging Leg Raise | **128** | × 66% = 84.5 | **`@ 85kg (66%)`** |
| Pull-Up (14 Sept) | **124** | × 72.5% = 89.9 | **`@ 90kg (72.5%)`** |

Both are `bodyweight` with `equipment = ['bodyweight']`. There is no bar to load; the kg figure is a
percentage of an internal index.

**The component already holds the answer and already documents the rule.** Its own prop comment reads
*"A bodyweight 1RM change in kg is a change in an internal index, not in weight lifted, so the
rationale must not quote it (Q-19)"* — and `exerciseTypeById` is right there. Q-19 applied that to the
**rationale** and not to the **exercise rows**, so line 283 computes `weightKg` unconditionally.

The fix is the branch that already exists: line 310 renders `@ {pct}%` when there is no 1RM, visible
on his own card as *Face Pull · 2×12 @ 66%*, which reads correctly. The entry warns against the
tempting alternative — relabelling 85 as "added weight" would turn a visibly absurd number into a
plausible wrong one, the trap BF-158 is already filed against.

## BF-163 — the tag is right and still contradicts its own row

`intensityZoneForPct` maps %1RM to a band with no reference to reps: 65–75% is **Hypertrophy**, and
his squat is at **72.5%**. So the label is correct by its own definition.

But the band carries `reps: '8–12 reps'`, rendered as the chip's tooltip, beside a prescription of
**2×6**. The row reads *"Hypertrophy · 65–75% … 2×6 @ 57.5kg (72.5%)"* — a load in the hypertrophy
band driving a rep count the **same table** calls Strength (4–6 reps).

The load and the reps genuinely disagree; `goal-ranges.ts` allows 5–12 reps for hypertrophy, so 6 is
legal for the goal — but the display band and the goal range are different tables with different rep
opinions and the card shows one of them. Recommended: label from the pair, or drop the `typically N
reps` clause so the chip claims only what it measures. The second is the honest one-line minimum.

**Not a defect in the plan itself** — the session note explains the reduced volume (low readiness,
reported lower-back soreness), so 2 sets is deliberate.

## Also observed: BF-156 has shipped

His screenshot carries the line *"Start the workout without accepting and you'll train the program's
normal loads, not these."* That is BF-156's fix on screen, on a `session_swap`-class prescription —
the opt-in half, which is exactly the case the entry was filed for.

## Not exercised

Docs only. Both mechanisms were read in the shipped component; the two kg figures were reproduced
from production `estimated_1rm` values.
