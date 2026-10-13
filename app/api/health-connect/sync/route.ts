import { DEFAULT_TZ } from '@trainingai/shared/date-utils';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getRepository } from '@/lib/data';
import { rateLimit } from '@/lib/rate-limit';
import { readJsonLimited } from '@trainingai/shared/http/request-guards';
import { healthConnectBatch } from '@trainingai/shared/validation/health-connect-import';
import { reportServerError } from '@/lib/observability';
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  if (!rateLimit(`health-connect-native:${userId}`, 120, 60000))
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  const body = await readJsonLimited(request, 2 * 1024 * 1024);
  if (!body.ok)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: body.reason === 'too_large' ? 413 : 400 },
    );
  const rebuild =
    !!body.body &&
    typeof body.body === 'object' &&
    Object.keys(body.body).length === 1 &&
    (body.body as { rebuild?: unknown }).rebuild === true;
  const batch = rebuild ? null : healthConnectBatch.safeParse(body.body);
  if (!rebuild && !batch?.success)
    return NextResponse.json({ error: 'Invalid health records' }, { status: 400 });
  const deferred = batch?.success
    ? batch.data.records
        .filter(
          (row) =>
            Date.parse(row.end) > Date.now() + 300000 ||
            Date.parse(row.modifiedAt) > Date.now() + 300000,
        )
        .map((row) => row.id)
    : [];
  const valid = batch?.success
    ? { ...batch.data, records: batch.data.records.filter((row) => !deferred.includes(row.id)) }
    : null;
  try {
    const repo = await getRepository();
    const result = rebuild
      ? await repo.rebuildHealthConnect(userId, session.user.timezone ?? DEFAULT_TZ)
      : await repo.applyHealthConnectBatch(userId, valid!, session.user.timezone ?? DEFAULT_TZ);
    return NextResponse.json(rebuild ? result : { ...result, deferred });
  } catch (error) {
    reportServerError(error, { userId, url: '/api/health-connect/sync' });
    return NextResponse.json({ error: 'Could not sync health records' }, { status: 500 });
  }
}
