# 2026-08-20 — all six ratchets stopped measuring merge order (LA-16 closed)

**Branch:** `chore/fetch-once-ratchet-order-independence` · **Lane A** · **closes LA-16**

The last two: `check-fetch-once-effects` and `check-strict-request-schemas`. With these, every
shrink-only ratchet in Custom Rules asks whether *this branch* made the thing worse rather than
whether the file is over its number.

## Classifying before writing, which is what the entry told me to do

LA-16 ended up naming two patterns, and the instruction it carried was to decide which each script
needs **before** writing anything. Both answers came out per-file:

- **`check-fetch-once-effects`** brace-matches `useEffect(() => {…}, [])` bodies **within one file's
  text**. No cross-file discovery — unlike the memo check, which has to learn the memoised component
  list first. So `countAtBase` with the extracted `countFetchOnce(src)` is correct and a base tree
  would have been machinery for nothing.
- **`check-strict-request-schemas`** already had `countNonStrict(src)`, a pure per-file counter. The
  seam existed; it just was not being used for a base.

Two scripts in one PR is a deviation from the *"one per PR"* I wrote into LA-16 myself. That rule was
about risk — the hard ones needing individual proof — and these are the two simplest of the six, each
proven independently below. Recording the deviation rather than quietly taking it.

## Proven, each independently

| script | inherited from `main` | branch adds one |
|---|---|---|
| `check-fetch-once-effects` | **GREEN** — *"1 fetch-once effect(s) against a baseline of 0, but the base branch is already there"* | **RED** — 2 effects |
| `check-strict-request-schemas` | **GREEN** — *"1 non-strict request schema(s) against a baseline of 0…"* | **RED** — 2 schemas |

## Where LA-16 finished

| script | pattern | base count from |
|---|---|---|
| `check-doc-index-size` (Q-424) | per-file, lines | `lineCountAtBase` |
| `check-component-size` | per-file, lines | `lineCountAtBase` |
| `check-hex-literals` | per-file, occurrences | `countAtBase` + its own matcher |
| `check-client-today-timezone` | per-file, occurrences | `countAtBase` + its own matcher |
| `check-memo-prop-stability` | **whole-tree** | `materialiseBaseTree` + the same `scan(rootDir)` |
| `check-fetch-once-effects` | per-file, occurrences | `countAtBase` + its own matcher |
| `check-strict-request-schemas` | per-file, occurrences | `countAtBase` + its own matcher |

One of seven needed the base tree, and it is the one whose count is not a function of a single file.
That distinction is the whole of what took the work from "apply the same change six times" to
something worth demonstrating each time.

## What this closes, in the terms it was filed in

Q-424 was filed after a branch cut from pristine `origin/main` failed `pnpm check:rules` on a change
that had nothing to do with the failure. **It cost four baseline resolutions in one session on
2026-08-19, and five more in this one before it was fixed.** Every ratchet that could produce that now
distinguishes *"your branch grew this"* from *"`main` is already over"*, and reports the second
without failing.

## The gate

`tsc` clean · `pnpm lint` **0 errors** · **Ran 51 of 51** Custom Rules steps · `pnpm build` clean ·
full suite green.

## Not exercised

Nothing user-facing; no route, schema, or device surface. As throughout: the **no-base fallback** —
where nothing resolves and every check reverts to the plain absolute comparison — cannot be exercised
locally, where `origin/main` always exists. It is stricter than the base-aware path, never weaker.
