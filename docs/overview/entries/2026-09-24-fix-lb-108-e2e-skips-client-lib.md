# LB-108 — E2E reported green without running, and a prefix list could not fix it

**PR:** `fix/lb-108-e2e-skips-client-lib` · **Lane:** O · CI workflow + one script. No product code.

## The defect

The E2E job always runs and always reports, skipping its expensive half when a PR cannot change what
Playwright sees — LA-22's design, refined by LA-63 which dropped `app/api/**`. Both are sound. The
prefix list simply never grew a `lib/` clause, because `lib/` was not browser-reached when it was
written.

PR #1173 changed `lib/resume-repaint.ts` and `lib/hooks/use-resume-repaint.ts`. **E2E went green in
40 seconds on a ~28-minute suite**; the job log is Postgres starting and stopping, with no Playwright
invocation at all.

## Why the entry's own recommendation was not enough

LB-108 recommended adding `lib/hooks/`, `lib/stores/` and `lib/media/` to the match. Measured before
building it:

- **28** files under `lib/` carry `'use client'` — the entry said 26.
- **`lib/media/` contains none of them.**
- Following imports from those roots, **81 of `lib/`'s 282 source files are client-reachable** and
  201 are not.
- The reachable set includes **`lib/sqlite/cache.ts`**, which every screen reads through, and
  **`lib/resume-repaint.ts`** — one of the two files in the PR that exposed this, and the one a
  subtree list still misses.

So a longer prefix list leaves the hole open, and matching all of `lib/` buys the full suite for 201
engine files and undoes LA-63. Neither is the fix.

## What shipped

**`scripts/e2e-ui-touched.js`** computes reachability instead of listing it: roots are the
`'use client'` files, and the walk follows their relative and `@/lib/…` imports. `app/api/**` and
`__tests__/` stay excluded, so an engine change still skips the browser. The workflow step is now one
line that pipes the changed files through it.

The set maintains itself, which is the point — the list drifted unnoticed for months and nothing
said so.

## Known floor, stated rather than papered over

Only static `from '…'` imports are followed. A dynamic `import()` built from a variable, or a module
reached solely via `require`, is not seen. Rare here, and the failure direction is the bad one, so a
new client entry point is worth a look at this file.

## Verification

13 unit tests: the LB-108 case, the cache path, an API route skipping, a vitest file skipping, an
engine module skipping, and three against the real tree (the adapter is *not* reachable;
`resume-repaint` *is*).

Direct runs: `lib/resume-repaint.ts` → `true`, `lib/sqlite/cache.ts` → `true`,
`lib/data/postgres/adapter.ts` → `false`.

`node` is preinstalled on `ubuntu-latest` and the script has no dependencies, so it runs before
`setup-node` as the step order requires. `grep` exiting 1 on no match is handled rather than thrown.

**Not verified here, and it is the entry's own warning:** the real proof is a job DURATION. This
cannot be confirmed by reading the workflow diff — the next PR touching only a client `lib/` file
should take minutes, not 40 seconds.

## Not exercised

CI config and a script. No product code, no device path.
