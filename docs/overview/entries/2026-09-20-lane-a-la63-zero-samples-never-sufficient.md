# 2026-09-20 — LA-63: the E2E failure count was nine, is one, and the one was a real bug

**Branch:** `lane-a/la63-zero-samples-never-sufficient` · **Lane A** · LA-63's residue.

## Why this was picked up at all

Every one of Lane A's six READY entries is blocked on an owner answer (LA-122). LA-63 sits under
`KEEP`, which tells the lane not to look — and its residue, *"nine real failures nobody had seen"*,
is buildable work with no owner gate. That is exactly the shape OR-100 is open about.

## The count was two weeks stale

Re-measured against `main` at `562ec1f2934`, on a database built the way CI builds one — `DROP` /
`CREATE`, all 277 migrations, then `seed.sql` — rather than against the session's shared dev
database and its 36 accumulated accounts. That distinction is the entry's own warning, and it is
load-bearing here: the seed defines what a zero-data account is.

Full suite, `CI=1`: **1 failed, 1 flaky, 1 skipped, 220 passed, 34.4 min.**

Eight of the nine had been fixed by other work and nobody re-ran the count. Four of the nine specs
had been edited since the entry was written. The entry's "one shared cause across seven nutrition
specs" theory was never tested and is now unfalsifiable — recorded so it is not re-derived.

**The one hard failure was not one of the nine.** `rv38-body-battery-no-data-badge` was written
2026-09-15, eight days after the entry.

## The defect

`GET /api/body-battery` for an account that has never worn anything:

```
hasData: false, confidence: { sampleCount: 0, wakingMinutes: 47, samplesPerHour: 0, sufficient: true }
```

`sufficient: true` on zero samples. The card shows its `Limited data` badge on `!sufficient`, so the
screen read **`Good / Steady / 50`, unqualified** — RV-38's defect, verbatim.

**RV-38 was never a complete fix, and this is not a regression against it.** The grace clause landed
2026-08-26 (`10d0ef9661a`); RV-38's card fix landed 2026-09-15 (`e81bbe8662b`). So the hole was
already there when RV-38 shipped, and RV-38's Known-Issues row states the payload returns
`sufficient: false` for the zero-data account — **true for twenty-three hours of the day and false
for the first one after waking.** It was verified at a time of day where the remaining hole was
invisible. That is worth naming on its own: an hour-scoped defect passes a careful check and a
careful review, because neither knows to ask what time it was.

The card was not at fault; its RV-38 condition is intact. `batteryConfidence` was:

```ts
sufficient: mins < MIN_WAKING_MINUTES_TO_JUDGE || samplesPerHour >= MIN_SAMPLES_PER_WAKING_HOUR
```

The first clause is sound reasoning — a rate measured over twenty minutes means nothing, so hold off
the verdict. What it gets wrong is that **zero readings is not a rate waiting to settle.** It is the
same nothing at 00:20 as at 23:59, and no amount of elapsed time makes it measured. Expressing "too
early to tell" as `sufficient: true` hands the card the opposite of the truth, and it is the same
shape as RV-38 itself: **a guard that gets weaker as the data gets worse.**

```ts
sufficient: sampleCount > 0
  && (mins < MIN_WAKING_MINUTES_TO_JUDGE || samplesPerHour >= MIN_SAMPLES_PER_WAKING_HOUR)
```

Narrowed to exactly zero, so the grace window still covers the sparse-rate case it exists for.

## It was also a clock-dependent test failure

The badge was withheld for the **first hour after waking**, so the spec was red between 00:00 and
01:00 Brisbane and green the other twenty-three — the Q-356 shape CLAUDE.md names, and a plausible
member of the original nine's flakiness. The zero-data account's wake anchor defaults to local
midnight, which is what puts its grace window there.

**The fix removes the clock dependence rather than papering over it**: zero samples is now
insufficient at every hour, so the spec's answer no longer depends on when it runs. The regression
test does not wait for the window either — `is the same answer on both sides of the boundary` reads
the boundary from `MIN_WAKING_MINUTES_TO_JUDGE` and fires on every run.

## Verification

Proven on the live failing condition rather than by reasoning: the spec failed **twice** at 00:47
Brisbane and passed at 00:48 with the fix, same database, same minute band.

`body-battery-inputs.test.ts`: 16 pass (was 13).

**Mutation pass — 2 mutations, each caught by its intended test:**

| mutation | caught by |
|---|---|
| drop `sampleCount > 0 &&` (revert the fix) | the two new boundary cases + the changed divide-by-zero case |
| widen it to `sampleCount > 1` | `still grants grace to a sparse rate` — and nothing else, which is the point |

**Equivalent control, green (16/16):** the condition rewritten De Morgan'd as
`!(sampleCount === 0 || (mins >= … && rate < …))`.

One existing expectation was changed deliberately: `batteryConfidence(0, 0).sufficient` was `true`
and is now `false`. Its test is named for division by zero and that half is untouched; the
`sufficient` line was incidental to it and was the only assertion anywhere holding the zero-sample
grace window in place. The change is noted in the test itself so it is not silently re-flipped.

## Blast radius

`batteryConfidence` has **one** caller (`app/api/body-battery/route.ts:327`) and `sufficient` has
**one** product consumer (`components/body-battery-card.tsx:103`). Nothing is stored — the value is
computed per request — so no day is re-scored and no migration is involved.

## Not exercised

- **CI will not run E2E on this PR.** The job's gate matches `app/`, `components/`, `e2e/` and
  `playwright.config.ts`; this diff is `packages/shared/**` only, so the browser half is skipped.
  The spec was run locally instead, inside the band that reproduces the failure. Touching an `e2e/`
  file purely to buy the run would be gaming the gate.
- **Device unexercised.** No native, offline-first, safe-area or gesture surface is touched — one
  boolean in a shared pure function.
- The **owner's own** Body Battery is unaffected in the ordinary case: they have samples. What
  changes for them is a day on which the ring reported nothing at all, which now carries the badge
  from waking rather than from an hour after it.

## Still owed, and not claimed fixed

`meal-label.spec.ts:286` flaked on the `Ingredients · centred` style and passed on retry. **Ink was
0.0802, so the canvas was painted** — a decode failure, not a render one, matching LB-38's root
cause (zxing cannot read certain valid QR symbols upright) that `decodeQrRotating` was added for and
does not fully cover. Left in LA-63's `Keep:`. Note for whoever takes it: the kept-pixels `.bin`
lands in `test-results/`, which Playwright wipes at the start of the next run, so a local repro
destroys its own evidence unless the file is copied out first.

## Two things found while gating this, both filed rather than fixed here

**LA-123 — a test file asserting a cluster-wide condition.**
`migration-test-lock.test.ts`'s `afterAll` counts advisory locks with no database, session or
process filter, while **15 sibling files** take the same key in parallel vitest workers. The first
full-suite run read `1 failed | 951 passed` against `9027 passed | 0 failed` — a file failing while
none of its tests do, which is the shape of a hook. A second run on the same tree was green. **A
second variable was present on the first run and not the second** (a `pnpm dev` server for the E2E
reproduction, on another database on the same instance), so those two runs cannot separate the
causes; the mechanism is readable in the source and does not depend on them. Filed with a proposed
patch rather than widened into this PR.

**A local-only lint trap, added to LA-77.** `pnpm lint` reported **256 errors** here and **0** once
`playwright-report/` and `test-results/` were deleted: both are gitignored but not eslint-ignored,
so the HTML reporter's bundled JavaScript gets linted. CI never sees it — Lint and E2E are separate
jobs — so it lands only on someone who runs both locally, disguised as 256 errors in their own
change. (LA-77's own figure is stale too: 290 warnings when written, 743 today.)

## Gate

| gate | result |
|---|---|
| `pnpm test` | **952 files, 9027 tests, 0 failed** |
| `pnpm check:rules` | **Ran 75 of 75** |
| `check-test-typecheck.js` | 320 errors across 90 files, **none above baseline** |
| `pnpm lint` | **0 errors**, 743 warnings (see LA-77) |
| `pnpm e2e` (full, CI-shaped DB) | 1 failed → **fixed**; 1 flaky (LB-38 decoder); 220 passed |
