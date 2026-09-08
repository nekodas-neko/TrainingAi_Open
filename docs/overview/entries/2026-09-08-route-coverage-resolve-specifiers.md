## 2026-09-08 — The coverage scan was wrong in both directions, and the errors nearly cancelled (PS-39)

**Branch:** `fix/route-coverage-resolve-specifiers` · **Lane A**

### What shipped

`scripts/check-route-test-coverage.js` now **resolves module specifiers** instead of matching a
substring, and ignores type-only imports. `BASELINE` **140 → 139**.

### Q-112d was right about the mechanism and wrong about the size

The scan used to ask whether any test file *contained the substring* `app/api/<route>/route`. Q-112d
found that a **relative** import never produces that substring, so a route whose own `__tests__/`
loads the handler as `await import('../route')` reads as untested. That is correct, it affects **13**
routes — `sync/push`, `sync/pull`, `body-battery`, `ai/health-insight`, `user/goals` among them — and
it predicted the debt was "nearer 126".

**The prediction was wrong because the rule was broken in the other direction too, by almost exactly
the same amount.** A substring is not an import. **12 routes read as COVERED because a test merely
mentioned the path** — almost always `import type { Response } from '@/app/api/<route>/route'`, which
borrows a response type and calls nothing:

| believed tested | what the "test" actually was |
|---|---|
| `workout-data` | `import type { WorkoutExercise }` in `deload-reverts.test.ts` |
| `nutrition/energy-balance` | `import type { EnergyBalanceResponse }` in `energy-summary.test.ts` |
| `weekly-digest`, `session-explain/insight`, `running-plan/explain`, +7 | same shape |

So: **140 − 13 + 12 = 139.** The old number was accidentally close to right for two wrong reasons,
which is exactly why extrapolating from one direction missed. Measured three ways to separate them —
old rule 140, resolver alone 137, resolver plus type-exclusion 139.

**Q-112d's own example is the tell it noticed but read one way.** It took `day-review/week-window`
off the list with a *type-only* import that tests nothing, while that route's real handler test had
been invisible the whole time. It called that "pointing the wrong way in both directions at once" —
which was the right description of a defect whose two halves it then counted only one of.

### How it resolves now

A relative specifier resolves against the importing file; `@/…` and bare `app/…` resolve against the
repo root; anything landing on `<apiRoot>/<route>/route` marks that route covered. `import type`
never counts. Comments are stripped first (LA-72's shared stripper), so a path in prose is not a
test.

### Verification

- `pnpm check:rules` — **Ran 70 of 70**. `tsc --noEmit` clean, `check-test-typecheck` at baseline,
  `pnpm build` exit 0, full suite green.
- The two difference sets were enumerated rather than estimated, and two false positives were opened
  and read to confirm they are `import type` and nothing else.
- The 13 recovered routes were checked to be genuinely uncovered under the old rule and covered
  under the new one, so the fix is doing what it claims in both directions.

**Not exercised:** the resolver does not follow re-exports, so a test importing a barrel that
re-exports a handler still reads as uncovered — none exist today. It also treats any non-type import
of the module as coverage, so a test that imports a handler and never calls it would still count;
that is the same shape as the type-only case and would need a call-site check, which is more than
this is worth.

No version bump: CI tooling only.
