import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getDb, ensureSchema } from "@/lib/data/postgres/client";
import { exerciseGifCache, exerciseMedia } from "@/lib/data/postgres/schema";
import { ilike, and, eq, sql } from "drizzle-orm";
import { StatusCodes } from "http-status-codes";
import { DATASET_BASE, loadDataset, findBestMatch, findDirectUrl } from "@trainingai/shared/exercise-gif-matcher";

const ExerciseNameSchema = z.object({
  name: z.string()
    .min(1, "Exercise name required")
    .max(100, "Exercise name too long"),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: StatusCodes.UNAUTHORIZED });
  }

  const { searchParams } = new URL(req.url);
  const name = (searchParams.get("name") ?? "").trim();

  const result = ExerciseNameSchema.safeParse({ name });
  if (!result.success) {
    return NextResponse.json({ gifUrl: null, imageUrl: null });
  }

  const validName = result.data.name;

  await ensureSchema();
  const db = getDb();

  // Check our generated exercise_media table first (preferred source)
  const generated = await db
    .select({ gifUrl: exerciseMedia.gifUrl, startUrl: exerciseMedia.startUrl })
    .from(exerciseMedia)
    .where(and(ilike(exerciseMedia.exerciseName, validName), eq(exerciseMedia.gender, 'male')))
    .limit(1);

  if (generated[0]?.gifUrl) {
    // Derive proxy URLs from the exercise name — stored URLs may be old absolute S3 URLs.
    const slug = validName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const gifUrl = `/exercise-media/gifs/male/${slug}.gif`;
    const imageUrl = generated[0].startUrl ? `/exercise-media/frames/male/${slug}-start.png` : null;
    return NextResponse.json({ gifUrl, imageUrl, source: 'generated' });
  }

  // Fall back to legacy dataset cache — skip entries where both URLs are null
  // (null can be cached when the dataset is temporarily unreachable on first lookup)
  const cached = await db
    .select()
    .from(exerciseGifCache)
    .where(ilike(exerciseGifCache.exerciseName, validName))
    .limit(1);

  if (cached.length > 0 && (cached[0].gifUrl || cached[0].imageUrl)) {
    return NextResponse.json({ gifUrl: cached[0].gifUrl, imageUrl: cached[0].imageUrl });
  }

  const direct = findDirectUrl(validName);
  let gifUrl: string | null = null;
  let imageUrl: string | null = null;
  if (direct) {
    gifUrl = direct.gifUrl;
    imageUrl = direct.imageUrl;
  } else {
    await loadDataset();
    const match = findBestMatch(validName);
    gifUrl = match ? `${DATASET_BASE}/${match.gif_url}` : null;
    imageUrl = match ? `${DATASET_BASE}/${match.image}` : null;
  }

  await db
    .insert(exerciseGifCache)
    .values({ exerciseName: validName, gifUrl, imageUrl })
    .onConflictDoUpdate({
      target: exerciseGifCache.exerciseName,
      set: {
        gifUrl: sql`COALESCE(${gifUrl}, exercise_gif_cache.gif_url)`,
        imageUrl: sql`COALESCE(${imageUrl}, exercise_gif_cache.image_url)`,
      },
    });

  return NextResponse.json({ gifUrl, imageUrl });
}
