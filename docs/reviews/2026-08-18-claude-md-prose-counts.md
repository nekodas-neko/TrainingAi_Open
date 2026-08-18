# Review — every count in `CLAUDE.md`, verified mechanically

**Date:** 2026-08-18 · **Agent:** Review 📖 · **Sweep 29** · **Finding:** Q-492

## Why this lens

Three separate sweeps this week each ended by finding that a number written into `CLAUDE.md`
prose no longer matched the repo — Q-480, Q-490, Q-491. Each was found by accident, while
looking at something else. This sweep does it deliberately: enumerate **every** checkable count
in the file and verify it against the tree.

The question is not "are the numbers right". It is **which kind of number stays right**.

## Method

`grep` for numeric claims in `CLAUDE.md`, discard the ones that are dated historical facts
("it was 31 on 2026-08-13"), and mechanically re-derive the rest against `origin/main` at
`63fb89c`. A claim counts as *script-backed* if the file tells you to run something to get it,
and *prose* if the number is typed into the sentence.

## Result

**Script-backed counts — 3 of 3 current.**

| Claim | Source | Verified |
|---|---|---|
| sparkline: 3 inline copies, 6 exempt | `check-sparkline-primitive.js` | ✅ exact |
| Custom Rules step count | `pnpm check:rules` prints `Ran N of N` | ✅ 40 of 40 |
| rollup vitest glob in step with its tests | glob vs directory listing | ✅ all 21 match |

**Prose counts — 7 of 9 stale.**

| Line | Claim | Actual | Direction |
|---|---|---|---|
| 485 | **471** hex literals under `app/`+`components/` | **428** (`check-hex-literals.js` says so itself) | overstated by 43 |
| 459 | 6 known >800-line hotspots, incl. `more/profile-tab.tsx` | **5** — `profile-tab` is 476 lines | stale list |
| 459 | `health-sections.tsx` "is now 795 lines" | **777** | harmless drift |
| 8 | script glob reaches "22 of 33 today" | **29 of 40** | stale |
| 251 | `READINESS_SCORE_TTL` at "four fetch/warm sites" | **6** | grew, all correct |
| 990 | suite is "448 files / 3,697 tests" | **504** test files on disk | grew |
| 494 | 9 chevron toggles, named | count right, **paths wrong** | filed as Q-491 |
| 493 | score-band at 17 call sites | **17** | ✅ correct |
| 8 | "the 11 inline grep rules" | **11** | ✅ correct |

So the correlation is strong but **not** absolute, and it should not be overstated: two
hand-typed counts are still right. What is absolute in this sample is the other direction —
**no script-backed count was stale.**

## Two things that are more than drift

**1. `more/profile-tab.tsx` should already have been struck, and there is a precedent for it.**
The same paragraph says a hotspot that drops under the line "must be removed from it in the same
PR", and records `health-sections.tsx` being removed on 2026-08-09 for exactly that reason.
`profile-tab.tsx` is now 476 lines — 40% under — and is not in `check-component-size.js`'s
BASELINE either. The documented procedure was followed once and then not again.

**2. The rollup-glob maintenance command cannot detect what it is for.**
`CLAUDE.md:976` prescribes keeping the vitest `rollup` glob in step with:

```
grep -rl aggregateOuraRawSamples lib/data/postgres/__tests__/
```

The warning it serves is *"a new rollup test outside it inherits the 5 s default and becomes the
next false alarm."* But the command is scoped to `lib/data/postgres/__tests__/` — the very
directory the glob covers — so it can only ever confirm the glob against itself. A rollup test
written anywhere else is invisible to the check that exists to find it. Secondly, `grep -l`
matches comments: it currently reports two files that never call the function
(`sleep-oura-id-user-scope.test.ts`, which is in the glob anyway, and
`night-vitals-extraction-oracle.test.ts` in `packages/shared/`, which only mentions it in a
header comment).

**Both defects are latent, not live.** Checked across every `*.test.ts` in the repo: there is no
test outside the glob that actually calls `aggregateOuraRawSamples`. Nothing is mis-timed today.
This is a procedure that would not fire when needed, not a present failure — and it is recorded
that way deliberately.

## One ratchet with slack

`scripts/check-component-size.js` is documented as shrink-only. Four of its five baselines are
exact; `components/workout-screen.tsx` is pinned at **1850** against an actual **1831**. That is
19 lines of regrowth that would pass silently. The other four leave zero.

## The recommendation

Not "fix the seven numbers" — that resets the decay clock and buys about a week. For each count,
either **cite the command** or **delete the number and keep the rule**. The file already contains
the model to copy, in its own sparkline paragraph:

> *Don't hand-count from `grep -rn '<polyline'`; run `node scripts/check-sparkline-primitive.js`,
> which is the maintained list.*

Every count above has a command that produces it — `check-hex-literals.js` and
`check-component-size.js` both already print their own totals. The hex paragraph is the sharpest
case: it exists to explain that the count grew "unnoticed because this line was prose and nothing
measured it", and it has since gone stale itself — in the safe direction, so a reader today
believes the ratchet is losing when it has actually clawed back 43.

**Headline:** *a count in prose is a claim with a decay date; a count in a script is a fact.*

## Not exercised

Docs and static verification only. No runtime, no device. The two rollup-glob defects are
reasoned from the command's scope and confirmed to have no current victim — not observed firing.
