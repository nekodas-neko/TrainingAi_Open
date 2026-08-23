import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getRepository } from '@/lib/data';
import { z } from 'zod';
import { MutationSchema } from '@trainingai/shared/sync/mutation-schema';
import { rateLimit } from '@/lib/rate-limit';
import { reportServerError } from '@/lib/observability';
import { readJsonLimited } from '@trainingai/shared/http/request-guards';

/**
 * The envelope caps the batch at 100 mutations, and the largest bounded domain — `workout_log`,
 * whose every array caps at 20 and every string at 200 — measures 6,010 bytes at its own limits, so
 * a full batch of the worst case is 0.57 MB. 4 MB is seven times that.
 *
 * Stated honestly: 0.57 MB is measured for that one domain. `MutationSchema.payload` is
 * `z.record(z.string(), z.unknown())`, so the envelope does not bound the other eighteen — their
 * per-domain schemas do, inside `pushMutations`, after this parse. The headroom is what covers them.
 * **Do not lower this without re-measuring**: this is the outbox, and a rejected batch is the
 * worst-case data-loss path in the app.
 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

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

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const parsed = EnvelopeSchema.safeParse(read.body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });

  const valid: z.infer<typeof MutationSchema>[] = [];
  // Q-476: a mutation that fails this schema used to be logged and then omitted from the response
  // entirely. An empty `errors` array is how the client is told everything succeeded, so
  // `resolveFailedOutboxIds` returned nothing, `confirmed` took the whole chunk, and
  // `deleteMutations` removed the row that was never written — no badge, no toast, no retry, no way
  // back. The route's own comment called that "quarantined"; quarantine is what the OTHER path does.
  //
  // It is reported as a per-item rejection now, which is the path that keeps the row, badges it and
  // dead-letters it at MAX_MUTATION_ATTEMPTS. **`retryable: false` is deliberate and is not the
  // adapter comment's wording.** Under Q-475's split, `retryable: true` means "the server could not
  // write" and makes the client back off the whole queue and stop draining — which is the wedge this
  // route exists to prevent, and wrong for a rejection that can never succeed. `false` routes it to
  // `recordMutationFailures`: attempts++, backoff, dead-letter, badge.
  const rejected: Array<{ id: string; domain: string; date: string; error: string; retryable: false }> = [];
  for (const raw of parsed.data.mutations) {
    const m = MutationSchema.safeParse(raw);
    if (m.success) {
      valid.push(m.data);
      continue;
    }
    const r = raw as { id?: unknown; domain?: unknown; date?: unknown };
    const id = typeof r?.id === 'string' && r.id.length > 0 ? r.id : null;
    const issue = m.error.issues[0];
    const where = issue?.path.length ? issue.path.join('.') : 'mutation';
    console.error('[sync/push] rejecting malformed mutation', { id, domain: r?.domain, date: r?.date, where });
    // No usable id means the client cannot match an error record back to a row — `id` is optional
    // in the schema for pre-v13 clients, and the domain:date fallback in `resolveFailedOutboxIds`
    // would mark every VALID sibling sharing that key as failed too. Dropping is all that is left.
    if (!id) continue;
    rejected.push({
      id,
      domain: typeof r?.domain === 'string' ? r.domain : 'unknown',
      date: typeof r?.date === 'string' ? r.date : '',
      error: `Rejected by the sync schema at ${where}: ${issue?.message ?? 'invalid'}`,
      retryable: false,
    });
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

    // Rejections first: they are the ones a reader is looking for when a mutation vanished.
    return NextResponse.json(
      rejected.length ? { ...result, errors: [...rejected, ...result.errors] } : result,
    );
  } catch (err) {
    console.error('[sync/push] pushMutations threw', err);
    reportServerError(err, { userId, url: req.nextUrl.pathname });
    return NextResponse.json({ error: 'Sync push failed' }, { status: 500 });
  }
}
