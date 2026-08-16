import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getRepository } from '@/lib/data';
import { rateLimit } from '@/lib/rate-limit';
import { reportServerError } from '@/lib/observability';

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isRestore = req.nextUrl.searchParams.get('mode') === 'restore';

  // Restore (full-history) and the normal recent pull get separate buckets. A
  // resumable restore drain fires many sequential pages back-to-back, so it must
  // neither exhaust nor be starved by the regular foreground sync cadence — and a
  // shared bucket would let either starve the other mid-loop.
  const allowed = isRestore
    ? rateLimit(`sync-pull-restore:${userId}`, 120, 60_000)
    : rateLimit(`sync-pull:${userId}`, 60, 60_000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const sinceParam = req.nextUrl.searchParams.get('since');
  const since = sinceParam ? new Date(sinceParam) : new Date(0);
  // Q-130: an unparseable cursor used to reach getSyncDelta as Invalid Date, throw inside it and
  // come back as the generic 500 — so a device with a corrupted cursor retried forever against an
  // opaque error. Name the param instead, which the client can act on.
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: 'Invalid since cursor' }, { status: 400 });
  }

  try {
    const repo = await getRepository();
    // mode=restore → windowDays:null skips the 90-day recent floor, honouring the
    // raw `since` (epoch = full history) for a wipe→restore drain. Default path
    // (undefined) keeps the 90-day clamp byte-identical.
    const delta = await repo.getSyncDelta(userId, since, isRestore ? null : undefined);
    return NextResponse.json(delta, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    // K8: one of the two reads the whole offline architecture leans on — a failure
    // here silently strands every device on stale data. Record it.
    reportServerError(err, { userId, url: req.nextUrl.pathname });
    return NextResponse.json({ error: 'Sync pull failed' }, { status: 500 });
  }
}
