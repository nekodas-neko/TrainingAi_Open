# 2026-08-20 — three more ratchets stopped measuring merge order (LA-16, half)

**Branch:** `chore/ratchets-order-independence` · **Lane A** · **LA-16 half done**, entry reduced

Q-424 fixed the doc-size ratchet: ask whether *this branch* grew the thing, not whether it is over —
because the second question is a fact about `main` as much as about the branch, and only the first has
an answer the branch author can act on. Six other shrink-only ratchets still asked the wrong one.

Three are converted: **`check-component-size`**, **`check-hex-literals`**,
**`check-client-today-timezone`**.

## The counting is the part that does not transfer

`verdict` is reusable as-is. The counts are not, and getting that wrong would be worse than leaving
the ratchets alone:

- `check-component-size` counts **lines**, so `lineCountAtBase` applies unchanged.
- The other two count **occurrences**, each with its own matcher — a regex for hex literals, a
  comment-stripping pass plus a regex for bare `todayInTz()`.

So `countAtBase(baseRef, rel, countFn)` takes the caller's **own** counting function and runs it over
the base content. **A second, near-identical regex for the base count would be worse than no base
count**, because it would disagree with the working-tree count for reasons nobody could see. Each
script's counting expression was extracted into one named function used for both sides.

## Proven, per script, both directions

For each: put a violation on `main` itself, then check a branch that did not cause it, then a branch
that made it worse.

| script | branch that inherited it | branch that added one more |
|---|---|---|
| `check-hex-literals` | **GREEN** — *"3 against a baseline of 0, but the base branch already has 3"* | **RED** — 4 literals |
| `check-component-size` | **GREEN** — *"1873 lines against a 1833-line baseline, but the base branch is already there"* | **RED** — 1883 lines |
| `check-client-today-timezone` | **GREEN** — *"17 bare call(s) against a baseline of 16"* | **RED** — 18 bare calls |

The ratchets still bite. What they stopped doing is biting the wrong branch.

## What is deliberately left, and why it is the harder half

`check-fetch-once-effects` and `check-memo-prop-stability` build their per-file counts with a
brace-matching scan over the source rather than a single expression, so extracting a `countFn(content)`
seam is a real refactor rather than a one-liner. `check-strict-request-schemas` I have **not read** —
recorded as unread rather than assumed to match either shape.

LA-16 stays open, retitled to the three that remain, with the pattern to copy named and a warning
that these are gates: **one per PR, each proven the same way.** A silently weakened gate is worse than
an order-dependent one.

## One thing found by being bitten

`pnpm check:rules` went red on the base-branch fetch step Q-424 added — a transient network failure,
green on the very next run. That step had turned a blip into a **red gate on an unrelated change**,
which is the exact failure this whole class of work exists to remove.

It is now `git fetch --depth=1 origin main || true`. A fetch failure must not fail the gate: with no
base resolvable the checks fall back to the plain absolute comparison, which is **stricter** than the
base-aware one, so the worst case is the behaviour we had before Q-424 — never a weaker check.

## The gate

`tsc` clean · `pnpm lint` **0 errors** · **Ran 51 of 51** Custom Rules steps · `pnpm build` clean ·
full suite green.

## Not exercised

Nothing user-facing; no route, schema, or device surface. As with Q-424, the **shallow-clone
fallback** — where no base ref resolves and the check reverts to the plain absolute comparison —
cannot be exercised locally, where `origin/main` always exists.
