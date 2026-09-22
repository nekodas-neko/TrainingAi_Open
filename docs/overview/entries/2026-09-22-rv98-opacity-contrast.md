# 2026-09-22 — RV-98: opacity-modified text was below AA, and the check could not see it

**Branch:** `fix/rv98-opacity-contrast` · **Lane:** Implementation B · **Version:** 1.465.3

## What shipped

`scripts/check-contrast.js` validated ten **bare token pairs** and had no opacity handling at all,
so everything from `text-muted-foreground/60` down was unguarded. Measured over `--card`: **70%
opacity is 4.64:1 and passes; 60% is 3.73, 50% 2.97, 40% 2.34, 30% 1.83** — against an AA floor of
4.5:1 for body text.

- **45 call sites raised to 70%** across 30 files.
- **Four exempted, each read in context and each with its reason written into the script**: a
  *future* day in the week strip (WCAG 1.4.3 exempts inactive components), two progress-ring
  **tracks** where `text-muted-foreground/30` is a `currentColor` fill behind a mask rather than
  text at all, and the `·` separator in the weather chip, where the values either side carry the
  meaning.
- **The calendar's `rest` marker went to FULL opacity, not the floor.** It is `text-[7px]` and the
  only thing distinguishing a past rest day from a past *untracked* one in the month grid, so it
  gets 8.36:1 rather than the 4.64:1 that merely clears AA.
- The check now parses `text-<token>/<n>`, composites, and fails with the measured ratio beside the
  file and line.

## The compositing was wrong on the first pass

`alphaRatio` initially blended the **linear** sRGB values. That put 40% opacity at **3.93:1** where
it is really **2.34:1** — an error that would have shipped a number in the failure message that
nobody could reproduce in a browser. CSS alpha-composites in the **gamma-encoded** space, so the
round trip has to be linear → encoded → blend → linear → luminance.

**What caught it was RV-98's own numbers.** The entry measured 1.83 / 2.34 / 2.97 / 3.73 and my
first output disagreed with all four. After the fix: **1.82 / 2.33 / 2.96 / 3.73** — independent
agreement to ±0.01. Given that twelve entry claims failed to survive contact across this sweep, an
entry whose measurements reproduce exactly is worth recording as such.

## Also fixed: `projectOverview.md` had three stacked version headers

Current Status opened with `**Version:** v1.465.2`, `v1.465.1` and `v1.465.0` on consecutive lines,
and carried a stray `**Version:** v1.464.8` + `**Last updated:**` pair buried mid-section. All four
are conflict-resolution residue, and **this lane's own recipe is how they got there**: *"keep BOTH
Current Status paragraphs"* is right about the paragraphs and wrong if it also keeps the header
above them. The baton now says to delete the loser's header explicitly. This is the file every
session reads first, so three contradictory version numbers at the top of it is worse than a stale
one.

## The RV-91 trap, repeated — with a second one under it

This test went red locally before it shipped, on **its own header**, which quotes the banned token
to state the rule. That is RV-91's `Cal`/`kcal` failure exactly, and **the lesson was already
written in this lane's baton** when I wrote this test. Writing a lesson down is not the same as
applying it.

Underneath it was a second bug in both tests: **`git ls-files app components -- '*.tsx'` does not
filter.** Git unions the three pathspecs, so `app` and `components` match every file beneath them
and `.ts` comes back too. RV-91's sweep has the same construction and survived only because its
`__tests__` filter happened to catch the file that would have tripped it. Both are now filtered on
the extension in JS, with the reason written beside them.

## A note on lane ownership

The entry scopes both halves to Lane B — the call sites *and* extending the script — while this
lane's baton says `scripts/**` is the Orchestrator's. Both were done here, because a guard that
ships separately from the fix it guards is a guard that arrives after the regression, and precedent
is clear: `check-cache-ttl-divergence.js` (Q-242) and `check-aest-midnight-timezone.js` (LA-19) both
shipped with the fixes they enforce. The baton's line is about the **queue tooling** — `next-item.js`,
`check-backlog-pointers.js` — not about every script in the directory.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean; the new check passes and reports the
  floor in its summary line.
- **Mutation-checked**: re-introducing a single `/40` makes the script exit non-zero and name the
  file, line and measured ratio. Stepping one site through 30/40/50/60 reproduced the whole table.
- **Controlled: all 3 unit cases go red** against the unfixed tree. One of them runs the script and
  asserts its summary mentions the floor — the vacuous case is a script that silently stops
  scanning, which would leave the rule intact while enforcing nothing.
- The test reads the exempt list **out of the script** rather than restating it, so the two cannot
  drift.

**Not exercised:** no device sitting. Contrast is computed from the tokens, not sampled from a
screen, and the 412px rendering is unchanged — but the whole point of the calendar fix is legibility
at low brightness on the S25, which only the device can confirm.
