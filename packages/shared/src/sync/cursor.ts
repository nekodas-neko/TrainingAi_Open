export interface DomainPage {
  maxUpdatedAt: Date | null
  hitLimit:     boolean
}

// When any per-domain query returned a full page, the pull is incomplete:
// the client must re-pull with since = the earliest capped domain's max
// updatedAt, minus 1ms so rows sharing that exact timestamp are re-fetched
// on the next page (duplicates are safe — applyDelta upserts are idempotent;
// skipped rows are not).
export function resolveSyncCursor(
  pages: DomainPage[],
  now: Date,
): { syncedAt: string; hasMore: boolean } {
  const capped = pages.filter(p => p.hitLimit && p.maxUpdatedAt)
  if (capped.length === 0) return { syncedAt: now.toISOString(), hasMore: false }
  const cursorMs = Math.min(...capped.map(p => p.maxUpdatedAt!.getTime())) - 1
  return { syncedAt: new Date(cursorMs).toISOString(), hasMore: true }
}
