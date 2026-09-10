# 2026-09-10 — a check for the mock shape that turned `main` red three times (LB-62)

**PR:** `lane-a/lb62-zero-arg-mock-check` · **Lane A** · a `scripts/` check + one CI step.

## The shape

`const f = vi.fn(async () => undefined)` declares no parameters, so TypeScript types
`f.mock.calls[0]` as the empty tuple `[]`. A spec that then reads `[0]` off it gets **TS2493**, and
an `as {…}` on the result adds **TS2352**. The mock still works at runtime — vitest records
arguments regardless of the declared signature — **so the spec passes and only the type checker
objects.** Three instances on 2026-09-07, each of which turned `main` red.

## The entry named a cheaper alternative. I priced it, and it was already spent.

LB-62 said to consider making `check-test-typecheck` runnable without a build, or adding it to
`pnpm ci:local`, *"which may make the bespoke check unnecessary."* That was the right question to ask
first. The answer:

- `pnpm ci:local` **already runs it** — `typecheck:tests` went in with **#770 on 2026-09-02**,
  **five days before all three incidents**.
- It **already runs without a build** — it needs `node_modules`, not `.next`.

So the cheap fix was in place and the class shipped anyway, because the authors were running `pnpm
lint` and `pnpm test` separately rather than `ci:local`. That prices the alternative at zero
remaining value and makes the targeted check the only lever left.

## What the check adds, stated honestly

**It finds nothing `check-test-typecheck` misses.** Both see the same 52 TS2493s. It finds them
**four minutes earlier** — in Custom Rules, which installs nothing and answers in ~25 seconds,
instead of the Build job after an install and a full `tsc` — and it prints the one-line fix instead
of a TS code.

## 39 sites baselined, and why not zero

Every hit is real: the type checker reports **52 TS2493 errors** across the tree, and each of the 39
line-hits appears in that output. No false positives. There are false *negatives* — a `vi.fn(`
whose arrow spans two lines is missed, e.g. `scale-ble-day-keying.test.ts`, which `tsc` catches and
this does not.

Clearing the 39 is not this check's job. Each fix means choosing the parameter types the assertion
reads, which is a judgement per site, and getting one wrong makes a spec assert against a shape the
code never produces. Shrink-only, in the repo's existing convention, and it shrinks when someone
touches the file.

## Verified in both directions

Five probes, and the third is the one that mattered:

| probe | result |
|---|---|
| A new file with a zero-arg mock indexed | **fails** ✓ |
| A zero-arg mock never indexed | allowed ✓ (no false positive) |
| **The prescribed fix — a typed mock, indexed** | **allowed** ✓ |
| A baselined file improved without lowering its row | **fails** ✓ (shrink-only holds) |
| Control: whitespace in the baseline | survives ✓ |

**A check whose suggested fix does not satisfy it is worse than no check** — it sends people in
circles. That is what the third probe exists to prove, and it is the one I would have skipped if I
had been going quickly.

`pnpm check:rules` now reads **72 of 72**, up from 71, picked up from the YAML by the runner rather
than any hardcoded count.

**Not exercised:** the CI job itself. The step is one line in `ci.yml` matching the twelve around it,
and `check:rules` parses that YAML and ran it, but the first real GitHub run is this PR's.
