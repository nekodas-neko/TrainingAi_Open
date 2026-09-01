# 2026-09-01 · Lane A — `main` was red on a guard that matched itself

Branch `fix/one-saved-list-label-self-match`. One file, two lines.

## What was failing

`components/nutrition/__tests__/one-saved-list-label.test.ts` scans `app`, `components` and `e2e` for
the string `My Meals` and asserts nothing user-visible still says it. It reported **two hits, both
inside itself**: its own matcher (`if (/My Meals/.test(line))`) and its own test name
(`it('no user-visible string says "My Meals"', …)`).

Neither is reachable by the comment-stripping the file already does, and correctly so — one is code
and the other is a string argument, not a comment. So the guard fails on `main` for everyone.

**Found by running the suite against a clean `origin/main` checkout**, while confirming an unrelated
failure was not mine. It is the same day's second example of a source scan whose first finding is its
own documentation — LA-53's lane-drift note did it twice this morning — and the third if you count
the block-comment case this file's own comment already records.

## The fix, and what it deliberately does not do

The scanner skips its own path. Not a cleverer matcher: the next person to add a line here quoting
the old name would hit it again, and a path exclusion says plainly that this one file is allowed to
name what it forbids.

**The guard keeps its value** — verified by adding `export const zzProbeLabel = "My Meals"` to
`meal-card.tsx`, which it catches and names.

## Verification

Full suite green. `pnpm check:rules` — Ran 67 of 67. Nothing device-visible; no route or component
changed.
