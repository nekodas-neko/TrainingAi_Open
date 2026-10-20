// The rules for what the phone does with a /api/sync/push answer. One copy, used by the current
// app (lib/local-store) and by TrainingAi Preview (mobile/), so the two cannot drift apart.

export interface PushErrorRecord {
  id?:    string;
  domain: string;
  date:   string;
  error?: string;
  // Q-475: the server could not write (database down/out of disk), so this says nothing about the
  // mutation. Absent on an older server, which is why every read of it defaults to false.
  retryable?: boolean;
}

export interface ResolvedPushFailure {
  error:     string;
  retryable: boolean;
}

// Map of failed outbox row id -> failure. Prefers exact id matching
// (new servers); falls back to domain:date for error records missing an id
// (old servers) — which retains every sibling sharing that key, matching the
// pre-id behaviour, never worse.
export function resolveFailedOutboxIds(
  chunk: Array<{ id: string; domain: string; date: string }>,
  errors: PushErrorRecord[],
): Map<string, ResolvedPushFailure> {
  const asFailure = (e: PushErrorRecord): ResolvedPushFailure =>
    ({ error: e.error ?? 'sync failed', retryable: e.retryable === true })
  const failed = new Map<string, ResolvedPushFailure>()
  const legacyByKey = new Map<string, ResolvedPushFailure>()
  for (const e of errors) {
    if (e.id) failed.set(e.id, asFailure(e))
    else legacyByKey.set(`${e.domain}:${e.date}`, asFailure(e))
  }
  if (legacyByKey.size) {
    for (const m of chunk) {
      if (failed.has(m.id)) continue
      const legacy = legacyByKey.get(`${m.domain}:${m.date}`)
      if (legacy !== undefined) failed.set(m.id, legacy)
    }
  }
  return failed
}

export const MAX_MUTATION_ATTEMPTS = 5

// 30s · 4^(attempts-1), capped at 1h: 30s, 2m, 8m, 32m, then dead-letter.
export function nextRetryDelayMs(attempts: number): number {
  return Math.min(30_000 * 4 ** (attempts - 1), 60 * 60_000)
}
