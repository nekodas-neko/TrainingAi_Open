export interface DomainPage {
  maxUpdatedAt: Date | null
  hitLimit:     boolean
}

/**
 * How far behind the pull's start a drained pull's cursor sits (#3654).
 *
 * `updated_at` is stamped by the `trg_set_updated_at` trigger with `now()`, which is the writer's
 * TRANSACTION start, and the row only becomes visible at COMMIT. A row stamped before a pull began
 * but committed after its SELECT for that domain was invisible to the pull, and a cursor at the
 * pull's start would put it behind every later pull for good. Re-reading the last stretch on the
 * next pull delivers it, provided the writer's transaction ran for less than this.
 *
 * Ten minutes, the margin `GET /api/nutrition/food-items/retired` already keeps for the same reason.
 * The pool's `idle_in_transaction_session_timeout` and `statement_timeout` (15 s each) keep real
 * write transactions to seconds, so this is very wide on purpose: what it costs is a re-send of the
 * last ten minutes' rows, which both apps apply as a no-op upsert.
 */
export const SYNC_PULL_OVERLAP_MS = 10 * 60_000

// `pullStartedAt` is read from the database's own clock BEFORE the pull's first SELECT, so it is
// on the same clock as the trigger's stamps and every row stamped after it is either read by this
// pull or by the next one.
//
// When any per-domain query returned a full page, the pull is incomplete and the client re-pulls
// with since = the earliest capped domain's max updatedAt. Each page is read `WITH TIES` on the
// millisecond of `updated_at` (#3672), so every row in the last row's millisecond is in the page,
// and the next page reads from the millisecond after it. The old `− 1 ms` instead re-read that
// millisecond on every page, so a group of rows sharing one stamp that was larger than a page came
// back as the same page forever. Re-sending a row is safe (applyDelta upserts are idempotent);
// skipping one is not.
export function resolveSyncCursor(
  pages: DomainPage[],
  pullStartedAt: Date,
): { syncedAt: string; hasMore: boolean } {
  const capped = pages.filter(p => p.hitLimit && p.maxUpdatedAt)
  if (capped.length === 0) {
    return { syncedAt: new Date(pullStartedAt.getTime() - SYNC_PULL_OVERLAP_MS).toISOString(), hasMore: false }
  }
  const cursorMs = Math.min(...capped.map(p => p.maxUpdatedAt!.getTime()))
  return { syncedAt: new Date(cursorMs).toISOString(), hasMore: true }
}
