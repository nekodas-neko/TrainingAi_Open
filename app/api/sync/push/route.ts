import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getRepository } from '@/lib/data';
import { z } from 'zod';
import { MutationSchema } from '@trainingai/shared/sync/mutation-schema';
import { rateLimit } from '@/lib/rate-limit';
import { reportServerError } from '@/lib/observability';

// Validate the envelope loosely, then each mutation individually. A single
// malformed mutation must NOT 400 the whole batch: the client pushes in chunks
// and stops draining the outbox on any non-2xx response, so one bad mutation
// would strand every valid mutation queued behind it — the "logged food silently
// disappears on reload" wedge. Instead we process the valid mutations and report
// the invalid ones per-item so the client drops them rather than retrying forever.
const EnvelopeSchema = z.object({
  mutations: z.array(z.unknown()).max(100),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`sync-push:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = EnvelopeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });

  const valid: z.infer<typeof MutationSchema>[] = [];
  for (const raw of parsed.data.mutations) {
    const m = MutationSchema.safeParse(raw);
    if (m.success) {
      valid.push(m.data);
    } else {
      // Unsyncable shape — log and drop it so it can't wedge the queue. Omitting
      // it from the response errors makes the client treat it as done (quarantined)
      // rather than re-pushing it forever.
      const r = raw as { domain?: unknown; date?: unknown };
      console.error('[sync/push] dropping malformed mutation', { domain: r?.domain, date: r?.date });
    }
  }

  try {
    const repo = await getRepository();
    const result = await repo.pushMutations(userId, valid);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[sync/push] pushMutations threw', err);
    reportServerError(err, { userId, url: req.nextUrl.pathname });
    return NextResponse.json({ error: 'Sync push failed' }, { status: 500 });
  }
}
