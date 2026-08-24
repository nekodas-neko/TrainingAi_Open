## Orchestrator — four owner decisions taken, one at a time (2026-08-23)

The top of the queue was three `Gate: owner` entries deep — positions 4, 5 and 6 — so Lane A was
stepping over three parked items to reach its work. The owner asked to be walked through them one
question at a time. All four are now answered, and two of them changed more than the question asked.

### Q-393 — the meal label. Removed, not unblocked.

Parked behind `Gate: owner` at position 36, **the position the owner had personally moved it to**,
while its own body contradicted itself: one bullet called Option 2 an open owner decision, a later
one called it moot. The later one was right.

Clearing the gate is what exposed the better answer. It put Q-393 at Lane B #16, **directly above
Q-392** — and `mealLabelStyle → ta_meal_label_style` was already a row in Q-392's table. Two entries
for one row of work. Removed, with the surviving half and the owner's decision folded into Q-392.
Option 2 is dead: 0.353 mm per module, below every shipped style.

**The lesson is about sequencing, not labels.** The cheaper outcome only became visible *after* the
first fix was applied. A gate can hide a duplicate.

### Q-85 — rest at a Quick budget. The owner's principle beat my recommendation.

I recommended shrinking rest with a 60 s floor. The entry's own measurement refutes it: rest is
**79% of a five-exercise Push**, and accessory rests are **already 60 s**, so that floor compresses
nothing. All the available time sits in the compound's 180 s — the rest the owner's principle
protects.

The owner's framing is what resolved it: *"rest was meant to be determined based on PCT… happy to
have rest be a bit shorter; but it should keep that in mind — and have a very solid floor."*
Measured across all **91 `style_sets` rows** in production, rest is already monotonic in intensity:

| %1RM | rest |
|---|---|
| 50–65% | **60 s** |
| 70% | 75 s |
| 75–80% | 90–130 s |
| 85–92% | 180–240 s |

So the principle was already in the data — but **hand-authored, not derived**: at 75% the catalogue
ranges 90 s to 180 s depending on the style's intent. The entry now says *scale the authored value,
do not replace it with a function of pct*.

**Decision: option (a), floor 45 s.** Accessories compress, the compound keeps full rest. The 45 s
was the whole question — at 60 s there is nothing to compress and (c) leave-it would have won.
Option (b), compressing the compound, is recorded as rejected: it would be the one place the
protect-the-primary discipline reverses.

### Q-420 — session RPE. The owner reversed the premise, and the data backs them.

Four calls: **delete the user-facing prompt**, derive a background intensity from set RPEs, store
derived separately from self-reported, keep the training-load chart labelled as derived. Deriving it
**dissolved the question that gated the entry** — the 6–10 → 1–10 mapping only mattered while a
human typed the number.

Then the correction that matters. This entry and Q-421 both said heart rate had made RPE redundant
for energy. The owner: *"HR only depicts cardio/heart rate, not CNS. Can't they work in
conjunction?"*

**Measured over the 44 sessions carrying both signals: `corr(avgBpm, mean set RPE) = +0.083`.**
Uncorrelated. Two structural reasons, both read from source: `summariseWorkoutHr` takes a **flat
mean across rest periods**, so a heavy day averages low exactly when it was hardest; and Keytel was
fitted on steady-state aerobic work, with no anaerobic or neuromuscular term.

| session | avg HR | mean set RPE | Keytel |
|---|---:|---:|---:|
| **74 min**, 74.4% 1RM, a set at RPE 9 | 73 | 7.27 | **207 kcal** |
| 48 min | 104 | 7.67 | **359 kcal** |

**The longer, harder session is credited 40% fewer calories**, at 2.8 kcal/min — barely above
sitting. So HR is the base and the derived intensity is a correction on it; neither overrides the
other. The formula is deliberately unpicked — it must be **fitted**, against Q-422's adaptive-TDEE
back-solve, which now carries `Needs: Q-420`.

Q-420 went from parked to **#1 in Lane A's ready list**.

### LB-2 — bulk-deleting a meal type's entries. Declined.

Move-only stays. Nobody is stuck (Q-326 shipped the move), the meal type can be deleted once empty,
and the alternative is a single irreversible tap that discards logged history feeding the calorie
trends, the TDEE calibration and Q-422's fitting. Removed from the queue; the decision lives in
[`docs/domains/nutrition/README.md`](../../domains/nutrition/README.md) under **Decided, and
deliberately not built**, so a future session finds it where it would look.

### Two process notes

**My own entry parked itself.** The first draft of Q-420's rewrite contained a `⛔` in prose, and
`next-item.js` read it as a blocker marker. The tool was right; the marker was mine. That is the
same class sweep 3 exists to clear, found by writing one.

**A question the owner cannot parse is a question not asked.** The first version of Q-393's question
was written for someone who had read the entry, and the owner said so. Every question after it led
with what the feature *is* in plain terms before what was being decided.

### One entry needed no question at all — Q-137

Walking to Q-137 (the Activity Score) expecting a fifth owner question, its own text had already
answered it: **"DECIDED 2026-08-11 — direction C"**, with a closing line reading *"what remains on
this entry: nothing — strike this entry once Q-188 and Q-190 land."* Both had, confirmed in source
(`hourly-movement.ts`, `activity-score.ts`, `score-audit/activity.ts`). Removed rather than asked
about — the live thread on the Activity Score is a later entry (Q-505) the owner had already
delegated on 2026-08-18. Same class sweep 1 exists for, found this time by reading before asking.

### Verification

`pnpm check:rules` — **54 of 54**. `check-backlog-pointers` — 192 entries, 13 `Needs:` with no
cycles, every target known. Queue 201 → 192 across the session; owner-gated entries 29 → 26.

**Not exercised:** nothing here touched the app. No runtime, no device, no version bump.
