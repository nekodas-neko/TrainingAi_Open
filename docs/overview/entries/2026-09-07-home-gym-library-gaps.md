# 2026-09-07 — the muscle nobody asked about had no home option at all (BF-130)

**Branch:** `feat/home-gym-library-gaps` · **Lane A** · **Migration 270**

## The report, and what checking it found instead

The owner was told his one uncovered muscle needed a Nordic hamstring curl: *"Not sure I can do this
at home."* The entry recorded that the catalogue's only knee-flexion hamstring movements were
`Leg Curl` (machine) and `Nordic Hamstring Curl` (which needs an ankle anchor) — so a home gym had
one option and it was the hardest movement in the category.

**Part of that is now stale, and part of it understated the problem.**

Stale: `Cable Lying Leg Curl` exists with `['cable']`. It was added at runtime after the entry was
written — the catalogue is only partly seeded, which BF-129 established the same day. So the cable
variant the entry asked for was already there.

Understated: the entry closed with *"nothing says hamstrings are the only category whose only options
need equipment a home gym lacks. Check each muscle."* Doing that found a worse gap than the reported
one. Across every main muscle:

| muscle | rows | reachable at home |
|---|---|---|
| **adductors** | **1** | **0** |
| abductors | 2 | 1 |
| hamstrings | 10 | 8 (but only 1 bodyweight, and that is the Nordic) |

**Adductors had exactly one exercise in the whole catalogue and it was `Adductor Machine`.** It was
the only muscle group with no home-reachable option at all, and nobody had looked because nobody had
asked about it.

That audit was only possible because BF-129 shipped a few hours earlier: with 22 rows carrying no
equipment, "reachable at home" would have counted every one of them as reachable.

## What shipped

Migration 270 adds four rows:

- **`Stability Ball Leg Curl`** and **`Slider Leg Curl`** — knee flexion, `['bodyweight']`, needing
  no machine and nothing to anchor the feet to. That last constraint is the whole point: a generic
  "there is a bodyweight hamstring exercise" is satisfied by the Nordic curl, which is the row this
  entry exists because he cannot do.
- **`Copenhagen Plank`** (`['bodyweight']`) and **`Cable Hip Adduction`** (`['cable']`) — the
  adductor gap, from the wider pass.

Hip extension stays the dominant hamstring pattern in the library; this adds the missing pattern
rather than rebalancing it, which matters because the owner's lumbar constraint is what makes a
loaded hinge the wrong substitute.

## Verification

- All four tests fail against the catalogue as it was and pass after the migration — checked by
  deleting the rows and re-running, not by assuming.
- The standing test is the last one: **every main muscle has at least one home-reachable exercise**,
  which is a guard rather than a snapshot of these four rows.
- Migration verified idempotent by replay (`ON CONFLICT (name) DO NOTHING`, matching 081/082); on a
  fresh database `check-catalogue-equipment` reports **all 144 selectable rows declare equipment**,
  so the new rows do not reintroduce BF-129's class.
- Full suite green; `tsc` clean; Custom Rules 68 of 68.

## Noted, not fixed

**Muscle names are case-inconsistent in the catalogue** — `Hamstrings` and `hamstrings`, `Lats` and
`lats`, `Upper Back` and `upper back`, each capitalised variant holding one or two rows. It is
**not** a live defect: `normalizeMuscle` lowercases, and the generation filter lowercases directly,
so both forms match everywhere checked. It is left alone rather than tidied because a rename touches
rows other accounts reference and the benefit is cosmetic. Recorded here so the next person who
notices it does not re-derive whether it matters.

**Not exercised:** the S25, and no `pnpm dev` call — this migration adds catalogue rows and changes
no code path. The rows will appear in the exercise picker, the swap sheet and generation candidates
on the next Railway deploy; none of those screens was opened.
