// Shared throttle predicate for opportunistic retention prunes fired from a
// write path (e.g. after an insert batch) — never a scheduled job, since this
// app has no cron layer. Mirrors the shape of lib/oura/sync-throttle.ts.
export function shouldPrune(lastPruneMs: number, nowMs: number, windowMs: number): boolean {
  return nowMs - lastPruneMs >= windowMs
}
