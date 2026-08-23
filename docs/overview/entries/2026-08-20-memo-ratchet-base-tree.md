# 2026-08-20 — the ratchet that could not be fixed per-file (LA-16, fourth of six)

**Branch:** `chore/memo-ratchet-order-independence` · **Lane A** · **LA-16 four of six**

`check-memo-prop-stability` now asks whether *this branch* defeated a memo, not whether the file is
over its number. That is the same change as the previous three — but it could not be made the same
way, and the difference is the point of this entry.

## Why the per-file seam is wrong here, and wrong in the unsafe direction

The other three ratchets count something that is a function of **one file's text**, so the base count
is that same function applied to the base's copy of that file.

This one is not. It first scans **every** file to learn which components are wrapped in `memo(...)`,
then counts inline-prop call sites for those names. Feed base *content* to a matcher built from the
**working tree's** component list and one case comes out wrong:

> A branch that newly memoises a component which already had inline-prop call sites would have those
> sites counted at the base too — so they read as **inherited**, and pass. But the branch is exactly
> what turned them into violations.

A gate that passes the change it exists to catch is worse than one that fires on the wrong branch. So
the base count comes from `materialiseBaseTree` — one `git archive` into a temp directory — and the
same `scan(rootDir)` runs over the base's own everything, its own memoised list included.

## Demonstrated

| | result |
|---|---|
| a violation sitting on `main`, unrelated branch | **GREEN** — *"1 inline-prop call site against a baseline of 0, but the base branch is already there"* |
| branch adding a second one | **RED** |
| **`main` has a non-memoised component with an inline call site** (no violation) | **GREEN** |
| **branch memoises it, touching nothing else** | **RED** — *"`<La16Plain>` — inline arrow in a prop"* |

The last two are the case the per-file shortcut would have passed.

## A probe that proved nothing, until it was checked

The first run of this test came back **green in both directions** — which I read as "the fix does not
work" for about a minute. It was the probe: I had injected `<Sparkline onX={…}>`, and `Sparkline` is
not memoised, so the detector was correctly ignoring it. Listing the 68 memoised names and picking a
real one fixed the test, not the code.

Worth recording because a mutation test that fails to mutate looks exactly like a fix that does not
fix, and the instinct is to go change the code.

## LA-16 now names two patterns, not one

The entry used to say "the counting differs per script". That was not enough to act on, so it now
says which of **two** shapes each remaining script needs, and tells the next session to decide *before
writing anything*: per-file where the count is a function of one file's text, whole-tree where it is
not. `check-fetch-once-effects` has not been classified — that is the first question to answer.
`check-strict-request-schemas` is still **unread**.

## The gate

`tsc` clean · `pnpm lint` **0 errors** · **Ran 51 of 51** Custom Rules steps · `pnpm build` clean ·
full suite green.

## Not exercised

Nothing user-facing. **`git archive` against a shallow CI clone** is the one new dependency: the tree
for the fetched base commit is present, so it resolves — but if it ever does not, `materialiseBaseTree`
returns `null` and the check falls back to the absolute comparison, which is stricter, never weaker.
