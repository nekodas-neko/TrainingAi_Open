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

    // Q-487: the outer catch below is the ONLY place this route reported to `error_events`, and
    // `pushMutations` never reaches it — it catches per mutation, deliberately, because that is what
    // makes the poison-pill rule work. So a push failure hit the server log and nothing else.
    //
    // The table it never reached is the one CLAUDE.md calls "the only view of faults that never
    // reach a human", and the one the session-start ritual reads. The shape of the gap is an
    // absence, which is why it survived: over the same retained window `/api/sync/pull` held 69
    // fault rows and `/api/sync/push` held zero, having never appeared. Not less traffic — the sync
    // provider runs push BEFORE pull in the same cycle.
    //
    // Only the retryable ones. A validation rejection is the client sending something wrong, not a
    // server fault, and reporting those would bury real failures in routine noise — the same
    // reasoning `app/api/exercises` uses to report only past its duplicate-name branch.
    const retryable = result.errors.filter(e => e.retryable);
    if (retryable.length > 0) {
      // One row per push, not per mutation. A 100-mutation batch against a dead database would
      // otherwise write 100 near-identical rows, and `error_events` is a table this repo has
      // already had to reclaim 49 MB from once.
      const domains = [...new Set(retryable.map(e => e.domain))].sort().join(', ');
      reportServerError(
        new Error(
          `sync/push: ${retryable.length} of ${valid.length} mutation(s) failed with a retryable ` +
          `server error [${domains}] — first: ${retryable[0].error}`,
        ),
        { userId, url: req.nextUrl.pathname },
      );
    }

    // Q-485: a discarded field is not a fault, so it does not go through the retryable path above —
    // but it IS a silent data loss on the canonical runtime, refused with a clear message on web and
    // dropped without one here. One row per push, same bound as the retryable report.
    if (result.warnings?.length) {
      reportServerError(
        new Error(`sync/push: ${result.warnings.length} mutation(s) had a value discarded — first: ${result.warnings[0].warning}`),
        { userId, url: req.nextUrl.pathname },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[sync/push] pushMutations threw', err);
    reportServerError(err, { userId, url: req.nextUrl.pathname });
    return NextResponse.json({ error: 'Sync push failed' }, { status: 500 });
  }
}
