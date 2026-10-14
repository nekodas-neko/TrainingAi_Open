import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getRepository } from '@/lib/data';
import { rateLimit } from '@/lib/rate-limit';
import { reportServerError } from '@/lib/observability';

/**
 * #2752. Every sleep_sessions id the server holds for the signed-in user, live or tombstoned, and the
 * server time the list was read at. Before #2749 the ring rollup hard-deleted and re-minted its
 * nights, so a device that had pulled the old ids still holds them, and no tombstone will ever reach
 * it. The device compares its synced `ble:` rows against this list and drops the ones the server no
 * longer has (`sweepGhostBleSleep` in `lib/local-store/sync-engine.ts`). Read-only: nothing on the
 * server is deleted or rewritten. Takes no input.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`sync-sleep-ids:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  try {
    const repo = await getRepository();
    const { asOf, ids } = await repo.listSleepSessionIds(userId);
    return NextResponse.json({ asOf: asOf.toISOString(), ids }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    reportServerError(err, { userId, url: '/api/sync/sleep-ids' });
    return NextResponse.json({ error: 'Sleep id read failed' }, { status: 500 });
  }
}
