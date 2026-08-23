# 2026-08-20 — a ratchet that measured merge order (Q-424)

**Branch:** `fix/doc-index-baseline-order-independence` · **Lane A** · closes **Q-424**, files **LA-16**

## The defect

`check-doc-index-size.js` compared the working tree against a committed number. That comparison is
order-dependent: two PRs can each be green against the number as it stood when their own job ran, and
their merged result be over it. Nothing detects that — CI has deliberately no `push: [main]` trigger,
and the entry is right that adding one is the wrong trade at ~11 billed minutes per merge.

So it surfaced later, on an unrelated branch, as an unrelated file being over an unrelated limit. It
read as *"your change was too big"* when the change was eleven lines. **It cost four baseline
resolutions in one session on 2026-08-19, and five more in this one** before it was fixed — every one
a merge-conflict-resolve-remeasure cycle on a docs-only change.

## The fix: change the question

Not *"is this file over its number"* — which is a fact about `main` as much as about the branch — but
**"did THIS BRANCH make it worse"**. A branch that did not grow the thing is not the branch that has
to fix it, whatever `main` currently holds.

`scripts/lib/base-ref.js` resolves the base branch and reads a file's size there; the pure `verdict`
returns one of three answers:

| | condition | outcome |
|---|---|---|
| `ok` | at or under the baseline | pass |
| `inherited` | over it, but no bigger than the base already is | **reported, not failed** |
| `fail` | over it, and this branch is what pushed it there | fail, naming how many lines *this branch* added |

`inherited` is printed on every run whether or not the run fails. `main` being over its own baseline
is real and worth fixing — it is just not the current branch's to fix, and answering it with a red
check on an unrelated change is what made this class so misleading.

**A partial cleanup is treated as `inherited` too.** A branch that shrinks an already-over file
without reaching the baseline must not be punished harder than one that does nothing, or the only
safe move on an inherited overage is to leave it alone.

## Demonstrated, not argued

The entry's acceptance criterion was *"two independently-green additive docs PRs can merge in either
order without the second one, or `main`, going red"*. Reproduced in a scratch clone, using the real
incident's shape — one PR tightening the baseline to zero slack, another growing the file within the
slack it had:

| | result |
|---|---|
| PR A alone (tighten baseline) · PR B alone (add 20 lines) | GREEN · GREEN |
| merged `main`, A then B | **GREEN** — `inherited`, reported |
| merged `main`, B then A | **GREEN** |
| a later unrelated branch cut from that `main` | **GREEN** |
| a branch that genuinely adds 15 more lines | **RED** — *"35 over its baseline — 15 of which this branch added"* |
| the same branch after raising the baseline for its own growth | GREEN |

The ratchet still bites. What it stopped doing is biting the wrong branch.

## Two things worth knowing

**CI needed one line.** `actions/checkout` is shallow, so `main` is not in the clone. A depth-1 fetch
of that one ref is enough, and the script degrades to the plain absolute comparison when no base is
resolvable — which can be too strict, never too lenient.

**Custom Rules now runs 51 steps, not 50.** The fetch is a step. This is exactly why the rule says to
quote the `Ran N of N` count rather than hardcode it.

## What is deliberately left

Six other shrink-only ratchets still compare against a committed absolute. Q-424's own text flagged
that the class is shared, but its acceptance criterion named only the docs check — and those
baselines are per-file **occurrence counts**, not line counts, so `lineCountAtBase` does not transfer:
each needs its own matcher run against the base ref. `verdict` is reusable as-is; the counting is not.
Filed as **LA-16** with that distinction on the entry, rather than swept in unmeasured.

## The gate

`tsc` clean · `pnpm lint` **0 errors** · **Ran 51 of 51** Custom Rules steps · `pnpm build` clean ·
full suite green. 6 unit tests on `verdict`, mutation-verified — removing the `inherited` branch turns
two of them red.

## Not exercised

Nothing user-facing; no route, no schema, no device surface. **The CI half is exercised only on this
PR's own run** — the fetch step and the shallow-clone path cannot be tested locally, where
`origin/main` always exists.
