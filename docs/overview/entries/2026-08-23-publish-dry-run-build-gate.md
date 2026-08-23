# 2026-08-23 — The gate that would have caught A4b's blocker (Q-313)

**Branch:** `fix/publish-dry-run-build-gate` · **Lane A** · tooling only

`scripts/publish-dry-run.js` runs six gates and not `next build`. A3 was recorded as having made the
model constants a runtime-only dependency, and a green `--all` from that script was the evidence.

It was wrong. Six modules still read a constant at **module scope**, and `next build` imports every
route to collect page data — so the build opened the files. Deleting them produced
`ENOENT … energy-expenditure-features.json` at *Failed to collect page data for
/api/achievements*: a failed Railway deploy, not a local annoyance. A4b fixed those six to read on
first use. This is about the gate that let it through.

## Both halves, because they answer different questions

**`next build`, `--all` only.** Cost is the reason it was left out, and the reason it goes behind the
flag rather than being dropped: a build is minutes where every other gate is seconds, and `--all` is
the mode that models the end state and is run rarely. The script's existing baseline re-run still
tells a pre-existing red from a regression, so a slow gate stays trustworthy rather than becoming one
people learn to ignore.

**`scripts/check-constants-module-scope.js`, every PR.** The entry called this the "cheaper partial"
and it is worth having either way: it catches the specific class in seconds, so it cannot come back
*between* dry-runs. `tsc --noEmit` cannot see any of this — the fault is a file read at import time,
not a type. Custom Rules is now **54 steps**.

## The checker uses TypeScript's parser, and the first draft is why

A brace-counting draft flagged this:

```ts
const K_ = (): ReturnType<typeof getAstdConstants> => (kCache ??= getAstdConstants())
```

That is **the A4b fix** — a memoised read-on-first-use — and it does not run on import at all. The
counter saw the arrow body's parens open and close on one line and read the call as top-level. A
checker that fails on the correct shape is worse than no checker, so it was rewritten to walk the
real AST: a call is module-scope only if no enclosing node defers execution (function, arrow, method,
accessor, constructor, class body).

The getter list is read out of `lib/oura-models/constants/index.ts` rather than hardcoded, so a new
getter is covered the day it is added rather than the day someone remembers a list exists.

## Verified

Three shapes, each planted in a throwaway file and the checker run:

| shape | expected | got |
|---|---|---|
| `const TOP = getOtsConstants()` | caught | caught |
| `const C_ = () => (cache ??= getOtsConstants())` | accepted | accepted |
| `export const g = () => getOtsConstants()` and a class method | accepted | accepted |

The conditional gate was evaluated rather than read: `--ready` composes 6 gates, `--all` composes 7
with `build` last. `pnpm check:rules` 54 of 54.

**Not run: the dry-run itself.** `--all` now takes a full `next build` on top of the whole vitest
suite, against a stripped copy of the tree — minutes, and it is the mode that is run rarely and
deliberately. What is verified here is that the gate is composed into `--all` and absent from
`--ready`, and that the fast checker it is paired with catches the exact class the missing gate let
through.
