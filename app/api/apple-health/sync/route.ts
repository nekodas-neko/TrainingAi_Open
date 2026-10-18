import { DEFAULT_TZ } from '@trainingai/shared/date-utils';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getRepository } from '@/lib/data';
import { rateLimit } from '@/lib/rate-limit';
import { readJsonLimited } from '@trainingai/shared/http/request-guards';
import { splitAppleImportBatch } from '@trainingai/shared/validation/apple-health-import';
import { reportServerError } from '@/lib/observability';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  if (!rateLimit(`apple-health:${userId}`, 120, 60000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const body = await readJsonLimited(request, 512 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: body.reason === 'too_large' ? 413 : 400 },
    );
  }
  const rebuild =
    !!body.body &&
    typeof body.body === 'object' &&
    Object.keys(body.body).length === 1 &&
    (body.body as { rebuild?: unknown }).rebuild === true;
  // #3045: samples are judged one at a time, so a bad one is refused with its reason and the rest
  // still land. Only a body that is not a batch at all is a 400.
  const batch = rebuild ? null : splitAppleImportBatch(body.body);
  if (!rebuild && !batch) {
    return NextResponse.json({ error: 'Invalid health records' }, { status: 400 });
  }
  const deferred = batch
    ? batch.batch.samples
        .filter((row) => Date.parse(row.end) > Date.now() + 300000)
        .map((row) => row.id)
    : [];
  const valid = batch
    ? { ...batch.batch, samples: batch.batch.samples.filter((row) => !deferred.includes(row.id)) }
    : null;
  try {
    const repo = await getRepository();
    const result = rebuild
      ? await repo.rebuildAppleHealth(userId, session.user.timezone ?? DEFAULT_TZ)
      : await repo.applyAppleHealthBatch(userId, valid!, session.user.timezone ?? DEFAULT_TZ);
    return NextResponse.json(rebuild ? result : { ...result, deferred, rejected: batch!.rejected });
  } catch (error) {
    reportServerError(error, { userId, url: '/api/apple-health/sync' });
    return NextResponse.json({ error: 'Could not sync health records' }, { status: 500 });
  }
}
