# 2026-08-24 — the synthetic MET table is usable, and its blocker was false (Q-312)

**Branch:** `fix/test-constants-met-floor` · **Lane A** · test fixtures + a generator script. No
runtime code, no migration, no APK.

## The blocker said a session could not do this. It could

Q-312's closing line: *"fixtures can only be regenerated on a machine that still has the vendor's
files… a session cannot do it. Needs the owner to run one command."* That reads right and is wrong,
and the reason is in the generator itself: `fakeNumber(n, seq)` uses `n` only to ask
`Number.isInteger`. **The synthetic value is a function of the walk position, not of the vendor's
number.** And `scrub` preserves every key and every array position, so walking the *committed
fixture* visits the same leaves in the same order and assigns the same `seq` as walking the real file
did.

That is a claim worth proving rather than asserting, so it was measured: replaying the walk over
every committed fixture file and re-deriving each non-MET leaf from `seq` alone reproduces
**6,330 of 6,330** values exactly, zero mismatches. The MET values could therefore be re-floored
here, and they are byte-identical to what the generator will emit the next time it runs with the
vendor files present.

## The prescribed fix would not have worked either

The entry says to *"scrub to a ramp starting at 1.0"*, on the sound reasoning that 1 MET **is**
resting metabolism. But the consumer is
`estWorkoutKcal = max(0, duration × (met − 1.5) × bmrPerMinute)`. A floor at 1.0 leaves `met − 1.5`
negative and the `max(0, …)` still returns **0** — every activity, every tier, exactly as degenerate
as before. **The floor has to clear 1.5, not 1.0.**

(A smaller correction: the entry says the guard *"returns null for every activity"*. It returns
**0** — `metForActivity` finds a number, and the subtraction is what collapses it. Same effect on
the tests, different mechanism, and the difference is what makes 1.0 insufficient.)

So the tiers get disjoint bands instead of a shared ramp — `met_easy` 2.0–2.9, `met_moderate`
4.0–4.9, `met_hard` 6.0–6.9. Disjoint is the point: it makes `easy < moderate < hard` a property of
the design rather than of where a value happened to land. Nothing here is the vendor's: that rest is
1 MET and that hard exceeds easy is public physiology, and no real number survives.

## Five guards removed, four kept — and one kept on purpose

| test | now |
|---|---|
| `activity-log-calories` — agrees with the aggregate that recomputes the same activity | **unguarded** |
| `daily-energy` — estimates a logged activity duration from distance | **unguarded** |
| `daily-energy` — only counts steps above the sedentary baseline | **unguarded** |
| `daily-energy` — subtracts a logged outdoor walk's steps (no double-count) | **unguarded** |
| `daily-energy` — sums the three sources into total | **unguarded** |
| `daily-energy` — a strength session in a sane range (~200–400 kcal) | stays `itVendor` — a **magnitude** |
| `daily-energy` — a run burns more than an equal-duration walk | stays `itVendor` — see below |
| `workout-energy` — the four pinned tier/kcal values | stay `itVendor` — genuine parity |

**The run-vs-walk one passes on the synthetic table today, and is still guarded.** Running lands at
`met_easy` 2.6 against walking's 2.2 — but only by accident: the ramp cycles on `seq % 10`, and
running (id 12, position 11) and walking (id 14, position 13) happen to land 0.4 apart in the right
direction. Insert one activity above position 11 in the vendor's dict and the offsets shift; the
ordering can invert with no code change at all. A key-based synthetic table structurally cannot
guarantee an ordering between two *named* activities — that ordering is a fact about the vendor's
table, which is what `itVendor` is for. Unguarding it would buy a test that passes by luck and fails
one day for a reason unrelated to anything anyone changed, which is the hardcoded-timestamp trap in a
different costume.

## Verified

- New `lib/oura-models/__tests__/test-constants-met-floor.test.ts` holds the invariant from the
  **fixture** side, because that is the side CI reads — the generator carries the same bands but only
  runs on a machine with the vendor files, so a check living only there is a check that never runs.
  Five cases: coverage, ≥ 1 MET, clears the 1.5 subtraction, tier ordering, disjoint bands.
- **Mutation:** against the pre-floor fixture, 4 of those 5 fail. The one that passes is the coverage
  case, which is the one that should.
- Full suite **562 files / 4,613 tests**, up from 4,603 passing and 56 skipped — +5 unguarded, +5 new.
- `pnpm check:rules` 54 of 54.

**Failure surfaces NOT exercised:** the generator's new branch has **not been run against the real
constants**, because they are not in this repo — that is the whole subject of the entry. What was
done instead is stronger than a spot check and weaker than a run: the walk that produces `seq` was
proven to reproduce exactly, over 6,330 values. The first real regeneration on a machine with the
vendor files is the confirmation, and it will show as an empty diff. Nothing runtime, device, native
or offline is touched.
