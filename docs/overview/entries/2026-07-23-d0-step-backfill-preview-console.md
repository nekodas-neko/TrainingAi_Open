## 2026-07-23 — D0: step backfill preview (read-only dry-run) + admin console

**Branch:** `claude/oura-ondevice-hybrid-5xycdr`. Follow-up to the `allowStepsDecrease` lever (#771,
merged this session). Builds the safe way to see the real scope of the historical step correction
before firing it — a read-only preview, plus a small admin UI so the owner can review and (only then)
trigger it themselves, no chat back-and-forth needed for the actual button-press. No version bump
(admin-only tooling).

### What shipped
- **`previewStepsBackfill(userId, timezone)`** (repository + adapter): a pure dry-run that mirrors the
  real backfill's query/pipeline/merge logic exactly (unbounded history, same `runStepCounterPipeline`
  + `mergeStepCounterWithLive`), but never writes. A day is only returned if it would **actually**
  change — same `sourceRank(oldSource) <= sourceRank('oura_ble')` condition the real `mergeSet` write
  applies, so a `manual`-sourced day is guaranteed to never appear (verified by test, not just
  asserted in a comment).
- **`GET /api/oura-ble/samples/step-backfill-preview`** — admin-gated, rate-limited (10/60s), returns
  `{ affectedDays, totalOldSteps, totalNewSteps, rows }`.
- **`StepBackfillConsole`** admin card (`/admin/oura-ble`): "Preview backfill" (safe, re-runnable) shows
  the day list + totals; a `destructive`-styled "Run backfill now" button only appears once a preview
  exists, gated behind a native `confirm()` stating the exact scope and that it's not reversible, then
  calls the existing `?allowStepsDecrease=1` redecode route from #771.

### Verification
- `pnpm exec tsc --noEmit` 0 new errors (2 pre-existing `onnxruntime-web`); changed-file lint 0 errors;
  `check-push-mutations`/`check-reconcile` green.
- New DB-backed tests (4 cases, `previewStepsBackfill` describe block): lists an `oura_ble` day that
  would actually change; **never** lists a `manual` day; drops a day once its stored value already
  matches; and explicitly confirms the preview call itself **never writes** to `body_metrics`. **87
  step/rollup tests pass** across the full suite.
- `pnpm dev`: the new preview route and the admin page both compile and serve cleanly (401/307, no
  import or 500 errors).

### Still pending — the actual owner-confirmed execution
This ships the tool; it does not run the backfill. The owner now has a safe way to see the real
before/after numbers on `/admin/oura-ble` and decide for themselves — the `destructive`-button
confirm() dialog *is* the explicit confirmation for this action, consistent with how other one-way
admin actions in this console already work (e.g. "Clear key").
