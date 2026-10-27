import { invalidatePartialNightWrite } from '@/lib/cache-groups'

export type MarkPartialNightResult = { ok: true } | { ok: false; reason: string }

/**
 * #2265 — the web build's write for marking a night partial (`partial: true`) or unmarking it. Posts
 * to `POST /api/sleep-sessions/partial` and invalidates through `invalidatePartialNightWrite`.
 *
 * Server-only on purpose: the current app's SQLite mirror has no marker column (a second schema
 * version for a control that is not built there), so there is no local write to make. The native app
 * queues a `partial_night` outbox mutation instead (`mobile/src/features/health/data/HealthStore.ts`).
 */
export async function markNightPartial(id: string, partial: boolean): Promise<MarkPartialNightResult> {
  const res = await fetch('/api/sleep-sessions/partial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, partial }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null
    return { ok: false, reason: body?.error ?? `HTTP ${res.status}` }
  }
  await invalidatePartialNightWrite()
  return { ok: true }
}
