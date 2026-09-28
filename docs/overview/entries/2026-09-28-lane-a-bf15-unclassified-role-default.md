# 2026-09-28 — BF-15: a missing exercise role is Accessory, not a Main lift

The owner reported isolation work rising to "a main level". The cause: both schema defaults and
twenty read sites turned a missing `exercise_role` into `primary`, the goal's heaviest band with an
AMRAP last set. All of them now fall back to `UNCLASSIFIED_EXERCISE_ROLE` (`accessory`):

- Postgres, via migration `202609280717`, which changes the default only.
- The local SQLite CREATE constant.
- Server, device and UI fallbacks, including the label and badge helpers, which had to agree with
  the editor's pill.

A `git grep` test fails on any `?? 'primary'` that returns. It had to run git without a shell:
`cmd.exe` passes single-quoted pathspecs literally, so the first version matched nothing on
Windows and a mutant survived.

**Defect (a), fixed in the same change as the plan required:** an Accessory exercise whose
Accessory phase had no style kept its own style, which could be null, leaving no prescribed
percentages. It now keeps its own style only when it has one, and otherwise takes the phase's
lighter style.

**The plan's whole-session rule was built, measured, and removed.** Re-run on the owner's sessions
from production on 2026-09-28, it scored **87% (61 of 70) on the plan's fixture**, below its own
90% bar. BF-16a corrected the muscle counts after the plan was written, and the hip thrusts now
list 5 muscles against the squat's 4. So the rule anchored AI-Phase1 and Shikai's Legs on the hip
thrust, against the owner's own "squat for legs". Lower days anchored on single-leg hip thrusts over
the split squat, and there were two Secondary/Accessory judgement calls. The catalogue has no field
that separates the squat from the hip thrust (one main muscle each), so a fix would have been a
heuristic fitted to this fixture. Every whole-session creation path already takes roles from the
model, with Primaries capped in code (BF-126). So the rule had no caller to justify it. The
single-add rule (never Primary) did ship, for Lane B to wire into the editor.

Tests: 9 in `bf15-session-roles.test.ts`, plus the updated label and export tests. The
defect-(a) and fallback-guard mutants are killed, the CI replay is clean, and the full suite is
green apart from the known comment-blindness interaction, which passes alone.
