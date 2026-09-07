## 2026-09-07 — E2E: the artifact three sessions were told to read does not exist (LA-63)

**Branch:** `fix/e2e-failure-legibility` · **Lane A**

### What the entry claimed, and what is actually true

LA-63 recorded that E2E fails whenever it runs — four runs, three sessions, one signature — and
inferred **"a Playwright or web-server startup timeout, not specs asserting and failing"** from the
Postgres service log showing only its 10-second health probe across the whole 25 minutes. It said
explicitly: *do not close this on the inference.* Good instruction, and the inference was wrong.

**Postgres logs no statements by default**, so an absent query log is not evidence of an idle
database — it is evidence of default `log_statement`. And 160 tests at `workers: 1` takes about that
long on its own.

Running the suite locally under `CI=1` against the CI seed settled it: **147 passed, 9 failed,
2 flaky, 2 did not run, 34.2 minutes.** The suite runs to completion and nine specs assert and fail.

### Why nobody had read the output

The entry pointed at the uploaded failure artifact as the thing to read. It has never existed.

CI's reporter list was `[['github'], ['list']]` — annotations and stdout, **neither of which writes
a file** — while the upload step pointed at `playwright-report/`, which only the `html` reporter
produces. `actions/upload-artifact` found nothing, warned, and reported **success**, so the step was
green and `list_workflow_run_artifacts` on #924's run returns `total_count: 0`. Confirmed locally:
the 9-failure run wrote no `playwright-report/` at all and left 20 trace and screenshot directories
unclaimed in `test-results/`.

### What shipped

- **`playwright.config.ts`** adds `['html', { open: 'never' }]` to the CI reporter list. Verified:
  after the change a run writes `playwright-report/index.html` plus its `trace/` directory.
- **The upload takes both `playwright-report/` and `test-results/`**, with
  `if-no-files-found: error` and the step gated on the browser run having happened. That guard is
  what would have surfaced this in one run rather than three sessions.
- **The UI gate drops `app/api/` before matching.** It matched `^app/`, so a migration and four API
  routes bought the full ~25-minute browser suite (that is how OR-102a got into the entry's table at
  all). Verified against eight path shapes: `app/api` alone skips, `app/api` + `lib` skips,
  `app/api` + `components` runs, pages and `components/` and `e2e/` and `playwright.config.ts` run,
  docs skip.

### Verification

- The reporter fix is checked by running it, not by reading the config: `playwright-report/` absent
  before, present with `index.html` and `trace/` after.
- The gate is checked by executing the exact shell pipeline against the eight path shapes above.
- `pnpm check:rules` — **Ran 68 of 68**, all passed. `tsc --noEmit` clean.

**Not exercised:** the change to the artifact upload itself only proves out on a red CI run, which
this PR cannot produce on demand — the reporter half is verified locally, the upload half is read
from the workflow. Nothing device- or product-facing; no version bump.

### What is still owed

LA-63 stays queued with a `Keep:` for the nine specs, now named rather than guessed at:
`edit-meal-batch-footer`, `first-run-empty-states`, `meal-detail-artboard-parity`, `meal-label`,
`meal-photo-picker`, `my-meals-artboard-parity`, `plan-rescale` (already LA-67), `saved-meal-tags`,
`preferences-survive-reinstall`. Seven are nutrition/meal, a cluster tight enough to suspect one
shared cause.

**Order matters, and that is the trap to avoid next:** `preferences-survive-reinstall` fails on both
attempts inside the full run and goes merely *flaky* when run alone, so at least some of these are
shared-state rather than the spec's own logic. Read the artifact this PR makes real before
concluding "local DB artifact" — that call was made wrongly once already on `plan-rescale` (RV-49).
