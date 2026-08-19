# 2026-08-19 — CLAUDE.md's counts now cite the command that produces them (Q-492)

**Branch:** `docs/claude-md-counts-cite-the-command` · **Lane:** Implementation A

## Why this is worth a PR

`CLAUDE.md` is the file every session reads before it may start, and five agents run concurrently. A
wrong number there is consumed by all of them before any code is touched.

**The entry's own measurements were a day stale**, which is the argument in miniature. Re-derived
against `main` today rather than trusted:

| claim in the file | entry said (08-18) | actual today |
|---|---|---|
| hex literals | 471 → 428 | **428** |
| custom-rules script glob | "22 of 33" | **38 of 49** |
| `READINESS_SCORE_TTL` sites | "four" → 6 | **11** |
| sparkline exempt files | "Six" | **7** |
| `more/profile-tab.tsx` in the >800-line hotspot list | 476 lines | **476** — still listed |
| score-band call sites | 17 | **17** ✅ |
| `workout-screen.tsx` size baseline | 1850 vs 1831 | **1850 vs 1833** |

Every script-backed count was current; the hand-typed ones had drifted further in one day.

## The fix is not "correct the numbers"

That resets the decay clock for about a week. For each count: **cite the command, or delete the
number and keep the rule.** The file already contained the model, in its own sparkline paragraph —
*"Don't hand-count from `grep -rn '<polyline'`; run `node scripts/check-sparkline-primitive.js`,
which is the maintained list."*

- **Hex literals** — the number is gone; the line now says `node scripts/check-hex-literals.js`
  prints the total and **not to restate it here**. The dated trend narrative stays, because it is
  history and reads as history.
- **The custom-rules glob** — the "22 of 33" ratio is gone. What mattered was never the ratio but that
  globbing `scripts/check-*.js` misses the inline grep rules, so the line now says the difference
  between that and `Ran N of N` *is* the count it misses.
- **Sparkline exempt files** — the count is gone; the script that prints it was already cited.
- **`READINESS_SCORE_TTL`** — "four fetch/warm sites" → "every one of its fetch/warm sites". The
  claim that matters is that they agree, not how many there are.
- **Chevron toggles** — the number is gone and the paragraph now says outright that the list is
  hand-maintained, has drifted, and that **Q-491 holds the live count**. No script exists to cite, so
  the honest move is to stop asserting a number and name where the truth lives.
- **`more/profile-tab.tsx` struck from the hotspot list** at 476 lines. The same paragraph mandates
  this and cites `health-sections.tsx` being struck on 2026-08-09 for exactly it — *the procedure was
  followed once and then not again*, which is now said in the file itself so the next reader sees why
  it was sitting there.

## Two mechanical fixes, both from the entry's optional scope

- **`check-component-size.js`'s `workout-screen.tsx` baseline: 1850 → 1833**, the actual. It is a
  shrink-only ratchet, so 17 lines of slack was 17 lines of silent regrowth.
- **The rollup-glob maintenance command was scoped so it could not detect what it is for.**
  `CLAUDE.md` said keep `vitest.config.ts`'s rollup glob in step with
  `grep -rl aggregateOuraRawSamples lib/data/postgres/__tests__/` — but that is scoped to the very
  directory the glob covers, so it can only confirm the glob against itself, and `grep -l` matches
  comments. Measured: the old command returns **21** files, the new
  `grep -rln 'aggregateOuraRawSamples(' --include='*.test.ts' .` returns **20** — repo-wide and
  matching a call rather than a mention. The extra one was a file that names the function without
  calling it. Both defects were latent (no rollup test lives outside the glob today); the procedure
  simply would not have fired when needed.

## Verified

`pnpm check:rules` **Ran 49 of 49**. `node scripts/check-component-size.js` passes at the tightened
baseline. `CLAUDE.md` is **1085 lines against a shrink-only budget of 1085** — every change was an
inline deletion or substitution, so the file did not grow.

**Not exercised:** documentation only. No code path, no route, no device. The counts removed here
cannot go stale again; the ones kept are dated history or script-backed.
