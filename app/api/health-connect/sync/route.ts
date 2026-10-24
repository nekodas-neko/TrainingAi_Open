import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getRepository } from '@/lib/data';
import { rateLimit } from '@/lib/rate-limit';
import { readJsonLimited } from '@trainingai/shared/http/request-guards';
import { splitHealthConnectBatch } from '@trainingai/shared/validation/health-connect-import';
import { reportServerError } from '@/lib/observability';
import { healthConnectSessionAsWorkout } from '@trainingai/shared/health/health-connect-workouts';
import { ingestDayRejection } from '@trainingai/shared/validation/ingest-clock';
import { storeHealthConnectWorkouts } from '@/lib/health/health-connect-workouts';
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
  // #2828 N3: records are judged one at a time, so a bad one is refused with its reason and the rest
  // still land. Only a body that is not a batch at all is a 400.
  const batch = rebuild ? null : splitHealthConnectBatch(body.body);
  if (!rebuild && !batch)
    return NextResponse.json({ error: 'Invalid health records' }, { status: 400 });
  const deferred = batch
    ? batch.batch.records
        .filter(
          (row) =>
            Date.parse(row.end) > Date.now() + 300000 ||
            Date.parse(row.modifiedAt) > Date.now() + 300000,
        )
        .map((row) => row.id)
    : [];
  const valid = batch
    ? { ...batch.batch, records: batch.batch.records.filter((row) => !deferred.includes(row.id)) }
    : null;
  const timezone = session.user.timezone ?? DEFAULT_TZ;
  try {
    const repo = await getRepository();
    if (rebuild) return NextResponse.json(await repo.rebuildHealthConnect(userId, timezone));
    const result = await repo.applyHealthConnectBatch(userId, valid!, timezone);
    // #2843, #3044: exercise sessions become activity logs keyed on their record id, through the
    // same path as the current app's (`/api/sync-health`), and a deletion tombstones the log. The
    // records themselves are stored above whatever happens here, so a session refused as an activity
    // is noted, not counted in `rejected` (which the phone settles against the batch).
    const workoutNotes: string[] = [];
    const today = todayInTz(timezone);
    const workouts = valid!.records
      .filter((row) => row.type === 'ExerciseSession')
      .map((row) => healthConnectSessionAsWorkout(row, timezone))
      .filter((s) => {
        const reason = ingestDayRejection(s.date, today);
        if (reason) workoutNotes.push(`exercise ${s.date} ${s.startTime}: ${reason}`);
        return !reason;
      });
    await storeHealthConnectWorkouts(repo, userId, workouts, workoutNotes);
    if (valid!.deleted.length)
      await repo.tombstoneHealthConnectActivityLogs(userId, { ids: valid!.deleted });
    return NextResponse.json({ ...result, deferred, rejected: batch!.rejected, workoutNotes });
  } catch (error) {
    reportServerError(error, { userId, url: '/api/health-connect/sync' });
    return NextResponse.json({ error: 'Could not sync health records' }, { status: 500 });
  }
}
