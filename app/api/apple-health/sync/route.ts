import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getRepository } from '@/lib/data';
import { rateLimit } from '@/lib/rate-limit';
import { readJsonLimited } from '@trainingai/shared/http/request-guards';
import { appleImportBatch } from '@trainingai/shared/validation/apple-health-import';
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
  const batch = rebuild ? null : appleImportBatch.safeParse(body.body);
  if (!rebuild && !batch?.success) {
    return NextResponse.json({ error: 'Invalid health records' }, { status: 400 });
  }
  if (
    batch?.success &&
    batch.data.samples.some((row) => Date.parse(row.end) > Date.now() + 5 * 60000)
  ) {
    return NextResponse.json({ error: 'Future health record' }, { status: 400 });
  }
  try {
    const repo = await getRepository();
    const result = rebuild
      ? await repo.rebuildAppleHealth(userId, session.user.timezone ?? 'Australia/Brisbane')
      : await repo.applyAppleHealthBatch(userId, batch!.data!);
    return NextResponse.json(result);
  } catch (error) {
    reportServerError(error, { userId, url: '/api/apple-health/sync' });
    return NextResponse.json({ error: 'Could not sync health records' }, { status: 500 });
  }
}
