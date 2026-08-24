import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/admin';
import { rateLimit } from '@/lib/rate-limit';
import { getDb, ensureSchema } from '@/lib/data/postgres/client';
import { exerciseLibrary, exerciseMedia } from '@/lib/data/postgres/schema';
import { generateExercisePair, DEFAULT_MODEL, type MuscleGroup } from '@/lib/exercise-image-gen';
import { createExerciseGif } from '@/lib/exercise-gif-creator';
import { uploadExerciseMedia, mediaKey, isStorageConfigured, downloadMedia, REFERENCE_FIGURE_KEY } from '@/lib/exercise-storage';
import { eq, and } from 'drizzle-orm';
import { StatusCodes } from 'http-status-codes';
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// Optional tuning flags; the body is normally absent.
const MAX_BODY_BYTES = 8 * 1024

const BodySchema = z.object({
  exerciseName: z.string().min(1).max(120),
  gender: z.enum(['male', 'female']),
  model: z.string().optional(),
  force: z.boolean().optional(), // regenerate even if already exists
}).strict();

// POST /api/admin/generate-exercise-media
// Body: { exerciseName, gender, model?, force? }
// Generates start + end PNG frames and an animated GIF, then stores them.
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
  if (!rateLimit(`admin-generate:${session?.user?.id ?? 'anon'}`, 10, 60_000)) {
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

  const { exerciseName, gender, model = DEFAULT_MODEL, force = false } = parsed.data;

  await ensureSchema();
  const db = getDb();

  // Skip if already generated (unless force=true)
  if (!force) {
    const existing = await db
      .select({ gifUrl: exerciseMedia.gifUrl })
      .from(exerciseMedia)
      .where(and(eq(exerciseMedia.exerciseName, exerciseName), eq(exerciseMedia.gender, gender)))
      .limit(1);

    if (existing[0]?.gifUrl) {
      return NextResponse.json({ status: 'exists', exerciseName, gender });
    }
  }

  // Fetch muscle data for prompts
  const libRows = await db
    .select({ muscles: exerciseLibrary.muscles })
    .from(exerciseLibrary)
    .where(eq(exerciseLibrary.name, exerciseName))
    .limit(1);

  const muscles: MuscleGroup[] = Array.isArray(libRows[0]?.muscles)
    ? (libRows[0].muscles as MuscleGroup[]).filter(
        (m) => m?.muscle && (m.role === 'main' || m.role === 'secondary'),
      )
    : [];

  // Load reference figure if one has been uploaded — used to anchor style
  const referenceImage = await downloadMedia(REFERENCE_FIGURE_KEY).catch(() => null) ?? undefined;

  // Generate start + end frames
  let startPng: Buffer;
  let endPng: Buffer;
  try {
    ({ start: startPng, end: endPng } = await generateExercisePair(
      exerciseName,
      gender,
      muscles,
      model as Parameters<typeof generateExercisePair>[3],
      referenceImage,
    ));
  } catch (err) {
    return NextResponse.json(
      { error: `Image generation failed: ${String(err)}` },
      { status: StatusCodes.INTERNAL_SERVER_ERROR },
    );
  }

  // Create animated GIF from the two frames
  const gifBuffer = await createExerciseGif(startPng, endPng);

  // Upload to S3 if configured, otherwise encode as data URLs
  const storageReady = isStorageConfigured();

  async function store(buf: Buffer, key: string, mime: string): Promise<string> {
    if (storageReady) {
      const url = await uploadExerciseMedia(key, buf, mime);
      if (url) return url;
    }
    // Fallback: data URL stored directly in Postgres
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  const [startUrl, endUrl, gifUrl] = await Promise.all([
    store(startPng, mediaKey(exerciseName, gender, 'start'), 'image/png'),
    store(endPng, mediaKey(exerciseName, gender, 'end'), 'image/png'),
    store(gifBuffer, mediaKey(exerciseName, gender, 'gif'), 'image/gif'),
  ]);

  // Upsert into exercise_media
  await db
    .insert(exerciseMedia)
    .values({ exerciseName, gender, startUrl, endUrl, gifUrl, modelUsed: model })
    .onConflictDoUpdate({
      target: [exerciseMedia.exerciseName, exerciseMedia.gender],
      set: { startUrl, endUrl, gifUrl, modelUsed: model, generatedAt: new Date() },
    });

  return NextResponse.json({
    status: 'generated',
    exerciseName,
    gender,
    model,
    storageMode: storageReady ? 's3' : 'db-fallback',
    startUrl: startUrl.startsWith('data:') ? '[data-url]' : startUrl,
    endUrl: endUrl.startsWith('data:') ? '[data-url]' : endUrl,
    gifUrl: gifUrl.startsWith('data:') ? '[data-url]' : gifUrl,
  });
}

// GET /api/admin/generate-exercise-media
// Returns list of all exercises with their media generation status
export async function GET() {
  const session = await auth();
  try {
    await requireAdmin(session?.user?.id ?? '', session?.user?.isAdmin);
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Same limit as the sibling handler above (Q-134).
  if (!rateLimit(`admin-generate:${session?.user?.id ?? 'anon'}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  await ensureSchema();
  const db = getDb();

  const [library, generated] = await Promise.all([
    db.select({ name: exerciseLibrary.name }).from(exerciseLibrary).orderBy(exerciseLibrary.name),
    db.select({
      exerciseName: exerciseMedia.exerciseName,
      gender: exerciseMedia.gender,
      gifUrl: exerciseMedia.gifUrl,
      generatedAt: exerciseMedia.generatedAt,
      modelUsed: exerciseMedia.modelUsed,
    }).from(exerciseMedia),
  ]);

  // Index generated media by "name|gender"
  const genMap = new Map(generated.map((r) => [`${r.exerciseName}|${r.gender}`, r]));

  const exercises = library.map((ex) => ({
    name: ex.name,
    male: genMap.get(`${ex.name}|male`) ?? null,
    female: genMap.get(`${ex.name}|female`) ?? null,
  }));

  return NextResponse.json({
    exercises,
    total: library.length,
    generatedMale: generated.filter((r) => r.gender === 'male').length,
    generatedFemale: generated.filter((r) => r.gender === 'female').length,
    storageConfigured: isStorageConfigured(),
  });
}
