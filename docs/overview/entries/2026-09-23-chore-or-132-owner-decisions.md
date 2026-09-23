# 2026-09-23 — OR-132a: four owner answers, and a date that was already in the database

**Branch:** `chore/or-132-owner-decisions` · **Lane:** O · docs and queue state only

**⚠ This is `OR-132a`, not `OR-132`.** Lane A filed a real queue entry as `OR-132` the same day
(*"five PRs are dead from the shallow-fetch defect"*) while this work was in flight under the same
number. Theirs is the canonical one — it is in the queue, this never was — so this takes the letter
suffix per CLAUDE.md's duplicate rule. The branch name keeps the old spelling because renaming it
would cost a second PR for nothing.

**`check-backlog-pointers.js` could not catch this**, and that is the point worth carrying: it fails
on a duplicate ID *inside the backlog*, and this collision was between a queue entry and a PR that
never filed one. Two sessions of the same role, neither able to see the other's unmerged work —
the exact shape CLAUDE.md warns about, in the one place the check does not reach.

The owner turned gesture navigation on, which revalidated the largest group of owed device checks,
and asked what else needed unblocking. Four questions went out; all four came back the same sitting.

| # | question | answer |
|---|---|---|
| 1 | DV-6 — a scrim behind the status bar on scroll? | **Gradient, in the shell, once** |
| 2 | LA-126 — the live nutrition targets, or the computed ones? | **"the corrected/calculated numbers only"** |
| 3 | BF-137 — the vial predates its own first dose; which is true? | **Vial opened the same day as dose 1** |
| 4 | How long should a device sitting be? | **45–60 min, clear a whole area** |

`Gate: owner` count: **104 → 102**.

## What changed

**DV-6 released.** A gradient rather than a solid strip, so the app stays edge-to-edge; in the shell
rather than per screen, because a per-screen rule is one every future screen can forget — which is
how this reached a device sweep in the first place.

**LA-126 released, with a constraint the answer created.** The owner wants the computed targets, and
**LA-125 now has to ship first**: the recommendation route serves 42 g fat / 143 g carbs where
`calculateBaseline` computes 39 / 150, so applying today would hand him the clamp's numbers while
telling him they are the baseline's — the one thing he did not ask for. Sequence is LA-125 → RV-66
re-run → he applies.

**The decision does not authorise a write to his data, and the entry's own instruction stands.** He
chose the outcome, not the mechanism. `nutrition_targets` is production data; the apply is one tap
in the sheet and it is his. He is moving 1,660 → 1,359 kcal and 150 → 111 g protein, which is a real
cut of three weeks' eating, not a correction.

**LA-125's own gate released too.** It existed so the owner saw the fat number before it shipped;
he now sees it at the point that matters — the sheet shows 39 g before the tap. A gate whose
protection is already built into the flow it guards is ceremony. The structural half (which formula
is authoritative) was taken here rather than put to him: **move the 0.6 g/kg floor into
`calculateBaseline`**, so the baseline is already safe and the clamp becomes a redundant guard
rather than a second opinion. Deleting the floor instead is rejected outright — the calorie floor
beside it is load-bearing for every cutting user. Reversal: one function, one test file.

**BF-137 released, and it did not need him for the part it was blocked on.**

## The part worth carrying

**BF-137 had been asking the owner for a date the database already held.** The entry estimated the
first Retatrutide dose at *"around 2026-09-04"* from a window count and named correcting it as the
owner action blocking the build. One query:

| dose | log_date | taken_at (Brisbane) | amount |
|---|---|---|---|
| 1 | **2026-09-07** | — NULL — | 0.5 mg |
| 2 | 2026-09-13 | 20:00 | 1 mg |
| 3 | 2026-09-20 | 20:46 | 1 mg |

The drug start is 2026-09-07, exactly, and was all along. Reading the table before writing the
prompt replaced a three-day-wrong guess with a fact and turned a blocking owner action into a
non-blocking one.

The owner's answer then earned its place on the question the data genuinely could not settle:
`opened_on` said 2026-09-10, three days *after* dose 1, so either the vial date was the auto-set
artefact BF-136 was filed about or dose 1 came from a different vial. He says same day — so the
field is wrong, and BF-184's "dose 1 predates the vial" observation resolves with it.

**Ask for the fact nobody has, not the fact nobody looked up.**

**The durable half:** build the exclusion on the **dose log**, never on `opened_on`. The exclusion
wants when the drug started; the vial field answers when this vial was mixed. They coincide here and
will not on the next vial — and the dose log gave the right date while the vial field was three days
out, which is the argument in one line.

## Not done

- **No code shipped.** DV-6's scrim is Lane B's, LA-125 and LA-126 are Lane A's. This PR records
  decisions; it does not act on them.
- **Dose 1's `taken_at` is still NULL** and nobody knows why the first log took the no-time path.
  That stays open in BF-184 as a code question, not an owner one.
- **The vial's `Opened on` is still 2026-09-10 in production.** Correcting it is one tap in the app
  and it is the owner's; nothing is blocked on it.

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps, unpiped. Docs and queue state only;
no product code, nothing to exercise on the device.
