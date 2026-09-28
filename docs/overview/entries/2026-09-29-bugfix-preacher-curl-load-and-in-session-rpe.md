# 2026-09-29 — a load he has failed at three times, and the RPE that reached nothing

**Agent:** BugFix intake. **Docs only** — no product code.

## What the owner reported

Mid-rest on Pull, after logging `Cable Preacher Curl 13.75 kg × 6` at RPE 10 against a prescribed 7:
*"This was too heavy for me. What is the role of this exercise? Should be accessory - would be nice
to be able to tell coach then and there if thats on the list of possibilities."*

## The role was already right

`session_exercises.exercise_role = 'accessory'`, style `Hypertrophy 3-set`. The badge on his card
was correct, so the role is not the cause and re-tagging it would fix nothing.

## BF-219 — the load has a five-week record and nothing reads it

Every `13.75 kg` outing on this exercise: **9 reps RPE 9, 8 reps RPE 10 (08-21) · 7 reps RPE 10
(09-06) · 6 reps RPE 10 (09-29)**. The reps fall 9 → 8 → 7 → 6 at RPE 9–10 throughout. Load
selection resolves a pct against a stored 1RM; no part of it consults that history.

**Autoregulation did not cause the jump**, which is worth recording because it is the obvious
suspect: the push branch returns `pctMultiplier: 1` on every path (`autoregulation.ts:86–107`) — it
adds a rep or a set, never load. The 66 → 77.5 move came from the plan.

**It will over-correct next week.** Today trips `missedReps` *and* the RPE dead band, so the
back-off fires for 5–10%, landing near 12.5 kg — which returned RPE 10 on 09-13. The oscillation is
legible in the table: 66% → RPE 6 → plan raises to 77.5% → RPE 10 → back-off → light again. Five
weeks, no settling.

**The 1RM is the first thing to examine.** The stored 17 / displayed 17.25 came off `11.25 × 12 at
RPE 6` — a set capped by the prescription, not by failure, and `prescriptionFactor` exists to make
exactly that reproduce the previous estimate. Read back from today's genuine failure set instead,
`repFactor(6) = 1.181` gives **≈ 16.2 kg**. About 6% high, which at 77.5% is most of the distance
between RPE 8 and RPE 10.

Filed `Lane: T` — it is a calibration, so a Tuning proposal is owed before anyone builds it.

## BF-220 — he already told the coach, in one tap

He logged RPE 10. The next set card still read `13.75 kg × 7 · ↑ up next`.

`computeRpeAdjustment` has **two** call sites in the repo — its own definition and
`autoregulation.ts:141`, which runs at prescription-generation time. Nothing on the workout screen
consults RPE. So the honest answer to *"is that on the list of possibilities"* is that it is not
currently possible, and the rule that would fire is already written and already agrees with him.

Recommended shape: **offer, do not apply** — a one-tap suggestion on the next set card that
pre-fills the weight dial, driven by `computeRpeAdjustment` unchanged so the in-session answer and
the next-week answer cannot diverge. Client-side, offline, no model call — it fires in a gym.

## Worth noting against Q-290

That entry found logged RPE carries almost no information (sd 0.87, effectively two values). On this
exercise it separates cleanly — RPE 6 on an easy session, RPE 10 on three heavy ones. Recorded in
BF-219 rather than reopening Q-290.

## Not exercised

Docs only. No device run, no code change. Which component chose 77.5% — the model or the rules
prescriber — was **not** traced, and that decides whether BF-219 is a prompt problem or a formula
problem; it is named as undiagnosed in the entry.
