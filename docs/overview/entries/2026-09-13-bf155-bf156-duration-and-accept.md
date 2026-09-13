# 2026-09-13 — BF-155 and BF-156, and the owner settles the macro anchor (BugFix intake)

Docs-only. Three things from one exchange.

## BF-155 — the durations are wrong, and not for the reason reported

The owner: *"my amrap week all has under 5mins workout time."* The symptom is real and the scope is
wider: **every session since 6 September**, AMRAP or not.

| session | real | printed | set rows | with `set_end_ms` |
|---|---|---|---|---|
| 12 Sep | **12.0 min** | **3 min** | 5 | **0** |
| 10 Sep | **38.3 min** | **3 min** | 5 | **0** |
| 9 Sep | 33.3 min | 2 min | 5 | 0 |
| 7 Sep | 40.0 min | 2 min | 5 | 0 |
| 5 Sep | 63.4 min | 61 min | 10 | 5 |

`logExerciseFromPayload` stamps each row `lastSetEndMs ?? workoutStartedAt ?? now`. With no
`set_end_ms` on any set, every exercise falls to the second rung — and that is one value per session.
All five rows on 12 Sep read **`logged_at = started_at = 00:38:37.167`, identical to the
millisecond**. `day-log` then computes `end = max(loggedAt + timeToComplete)`, which is the start
plus the single longest exercise: 202 s, so 3 min. `completed_at` was correct on the session row the
whole time and is never read.

**The entry deliberately does not pick between two triggers.** Every broken session has exactly one
set per exercise and every good one has two or more; every broken session is also baseline-shaped.
The 5-of-10 ratio on the working sessions says `set_end_ms` was already sparse there, so "the last
set is missing one" does not explain it either. That needs the path walked rather than guessed.

**It is filed as Lane A because `logged_at` is not only a label** — it orders 1RM history and trend,
breaks PR ties, and keys per-set HR attribution. Five sessions now hold rows claiming one instant.
The fix is in two parts and the entry says so: prefer `completed_at` in `day-log`, *and* restore the
missing `set_end_ms`. Shipping only the first repairs the card and leaves everything else reading
collapsed timestamps.

## BF-156 — one button, two opposite consequences

*"What happens if I dont select to apply the session? Its pretty easy to miss that button."*

Two answers, and the card looks the same for both. `prescriptionDrivesLoad` splits the phase actions:
a pending `stay` or `transition_recommended` **already drives today's loads**, so skipping Accept
costs only the phase decision. A pending `deload`, `session_swap_recommended` or rest **does not** —
skipping Accept silently reverts to the program's base style.

He has a row at `pending` / `session_swap_recommended` right now, so this is live rather than
theoretical. The design itself is right and the entry does not reargue it; `apply-prescription.ts`
explains the split well. The defect is presenting a rule with two opposite outcomes through one
unlabelled button.

## BF-154's open question, answered

*"Can we have it dynamically sized for my calories?"* — the macro grams follow the budget.
`scaleMacrosForEarnedKcal` already grows them with earned movement; what changes is the base it
scales from. Recorded on BF-154 with the flag that protein is held constant by that function, so
re-basing from 1,660 to ~1,294 drops carbs and fat while 150 g protein stands.

## Not exercised

Docs only. Every figure above is from production rows; the mechanisms were read in the shipped
source, not run.
