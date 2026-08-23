import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/admin';
import { rateLimit } from '@/lib/rate-limit';
import { getDb, ensureSchema } from '@/lib/data/postgres/client';
import { exerciseMedia } from '@/lib/data/postgres/schema';
import { uploadExerciseMedia, mediaKey, isStorageConfigured } from '@/lib/exercise-storage';
import { loadDataset, findBestMatch, findDirectUrl, DATASET_BASE } from '@trainingai/shared/exercise-gif-matcher';
import { eq, and } from 'drizzle-orm';
import { StatusCodes } from 'http-status-codes';
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// Optional tuning flags; the body is normally absent.
const MAX_BODY_BYTES = 8 * 1024

const BodySchema = z.object({
  exerciseName: z.string().min(1).max(120),
  force: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  try {
    await requireAdmin(session?.user?.id ?? '', session?.user?.isAdmin);
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Q-134: these media routes were the only admin routes with no limit at all, while every
  // other AI/expensive one has had one since creation. Admin-gated, so the exposure is a
  // mis-click or a runaway client loop rather than an attacker — but generation is slow and
  // paid, which is exactly what a limit is for.
  if (!rateLimit(`admin-mirror-gifs:${session?.user?.id ?? 'anon'}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  // Optional body: an absent or unreadable one falls back to {}, only an oversized one is refused.
  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok && read.reason === 'too_large') {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 });
  }
  const body = (read.ok ? read.body : null) ?? {};
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: StatusCodes.BAD_REQUEST });
  }

  const { exerciseName, force = false } = parsed.data;

  await ensureSchema();
  const db = getDb();

  // Skip if already has a GIF unless force=true
  if (!force) {
    const existing = await db
      .select({ gifUrl: exerciseMedia.gifUrl })
      .from(exerciseMedia)
      .where(and(eq(exerciseMedia.exerciseName, exerciseName), eq(exerciseMedia.gender, 'male')))
      .limit(1);

    if (existing[0]?.gifUrl) {
      return NextResponse.json({ status: 'exists', exerciseName });
    }
  }

  // Resolve dataset GIF URL using the same matcher the exercise-gif route uses
  await loadDataset();
  const direct = findDirectUrl(exerciseName);
  const datasetGifUrl = direct?.gifUrl
    ?? (() => { const m = findBestMatch(exerciseName); return m ? `${DATASET_BASE}/${m.gif_url}` : null; })();

  if (!datasetGifUrl) {
    return NextResponse.json({ status: 'no_match', exerciseName });
  }

  // Download the GIF from the dataset
  let gifBuffer: Buffer;
  try {
    const res = await fetch(datasetGifUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${datasetGifUrl}`);
    gifBuffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      { error: `Download failed: ${String(err)}` },
      { status: StatusCodes.BAD_GATEWAY },
    );
  }

  // Upload to S3 (or fall back to data URL if storage isn't configured)
  const storageReady = isStorageConfigured();

  async function store(gender: string): Promise<string> {
    const key = mediaKey(exerciseName, gender, 'gif');
    if (storageReady) {
      const url = await uploadExerciseMedia(key, gifBuffer, 'image/gif');
      if (url) return url;
    }
    return `data:image/gif;base64,${gifBuffer.toString('base64')}`;
  }

  const gifUrl = await store('male');

  await db.insert(exerciseMedia)
    .values({ exerciseName, gender: 'male', gifUrl, modelUsed: 'dataset-mirror' })
    .onConflictDoUpdate({
      target: [exerciseMedia.exerciseName, exerciseMedia.gender],
      set: { gifUrl, modelUsed: 'dataset-mirror', generatedAt: new Date() },
    });

  return NextResponse.json({
    status: 'mirrored',
    exerciseName,
    storageMode: storageReady ? 's3' : 'db-fallback',
    gifUrl: gifUrl.startsWith('data:') ? '[data-url]' : gifUrl,
  });
}
