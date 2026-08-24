import { NextRequest, NextResponse } from "next/server";
import { refusalResponse, isRefusal } from "@/lib/api/route-errors";
import { reportServerError } from "@/lib/observability";
import { auth } from "@/auth";
import { requireAdmin } from "@/lib/admin";
import { getRepository } from "@/lib/data";
import { getDb, ensureSchema } from "@/lib/data/postgres/client";
import { exerciseGifCache } from "@/lib/data/postgres/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { MuscleAssignment } from "@trainingai/shared/types/program";
import { invalidateExerciseMuscleMap } from "@/lib/data/exercise-muscle-map-cache";
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One exercise: a name, muscles, equipment and 2,000 chars of instructions.
const MAX_BODY_BYTES = 32 * 1024;

const ExerciseBody = z.object({
  name:         z.string().min(1).max(120),
  equipment:    z.array(z.string()).default([]),
  muscles:      z.array(z.object({ muscle: z.string(), role: z.enum(['main', 'secondary']) })).default([]),
  instructions: z.string().max(2000).optional(),
  exerciseType: z.enum(['weighted', 'bodyweight']).default('weighted'),
  gifUrl:       z.string().url().or(z.literal('')).nullable().optional(),
  imageUrl:     z.string().url().or(z.literal('')).nullable().optional(),
}).strict();

export async function GET() {
  const session = await auth();
  try {
    await requireAdmin(session?.user?.id ?? "", session?.user?.isAdmin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const repo = await getRepository();
  const library = await repo.listExerciseLibrary();

  await ensureSchema();
  const db = getDb();
  const gifRows = await db.select({
    exerciseName: exerciseGifCache.exerciseName,
    gifUrl:       exerciseGifCache.gifUrl,
    imageUrl:     exerciseGifCache.imageUrl,
  }).from(exerciseGifCache) as { exerciseName: string; gifUrl: string | null; imageUrl: string | null }[];
  const gifByName = new Map(gifRows.map(r => [r.exerciseName.toLowerCase(), r]));

  const exercises = library.map(e => ({
    ...e,
    gifUrl:   gifByName.get(e.name.toLowerCase())?.gifUrl ?? null,
    imageUrl: gifByName.get(e.name.toLowerCase())?.imageUrl ?? null,
  }));

  return NextResponse.json({ exercises });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  try {
    await requireAdmin(session?.user?.id ?? "", session?.user?.isAdmin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const body = ExerciseBody.safeParse(read.body);
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const repo = await getRepository();
  const entry = await repo.upsertExercise({
    name:         body.data.name,
    equipment:    body.data.equipment,
    muscles:      body.data.muscles as MuscleAssignment[],
    instructions: body.data.instructions || undefined,
    exerciseType: body.data.exerciseType,
  });
  invalidateExerciseMuscleMap();

  // Write custom GIF URL to cache if provided
  if (body.data.gifUrl) {
    await ensureSchema();
    const db = getDb();
    await db.insert(exerciseGifCache)
      .values({ exerciseName: entry.name, gifUrl: body.data.gifUrl, imageUrl: body.data.imageUrl || null })
      .onConflictDoUpdate({
        target: exerciseGifCache.exerciseName,
        set: { gifUrl: body.data.gifUrl, imageUrl: body.data.imageUrl || null },
      });
  }

  return NextResponse.json({ exercise: entry }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  try {
    await requireAdmin(session?.user?.id ?? "", session?.user?.isAdmin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { id, ...rest } = (read.body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = ExerciseBody.safeParse(rest);
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const repo = await getRepository();
  let entry;
  try {
    entry = await repo.adminUpdateExercise({
      id,
      name:         body.data.name,
      equipment:    body.data.equipment,
      muscles:      body.data.muscles as MuscleAssignment[],
      instructions: body.data.instructions || undefined,
      exerciseType: body.data.exerciseType,
    });
  } catch (e) {
    // Every error answered 409 with its own text as the body, so a missing row read as a name
    // clash and a driver failure published its statement (Q-320). The status now comes from the
    // thrown error: 404 missing, 409 clash, 500 anything unmarked.
    if (!isRefusal(e)) reportServerError(e, { url: '/api/admin/exercises' });
    return refusalResponse(e, "Update failed");
  }
  invalidateExerciseMuscleMap();

  await ensureSchema();
  const db = getDb();
  if (body.data.gifUrl) {
    await db.insert(exerciseGifCache)
      .values({ exerciseName: entry.name, gifUrl: body.data.gifUrl, imageUrl: body.data.imageUrl || null })
      .onConflictDoUpdate({
        target: exerciseGifCache.exerciseName,
        set: { gifUrl: body.data.gifUrl, imageUrl: body.data.imageUrl || null },
      });
  } else {
    // Clear any cached GIF so the auto-matcher retries
    await db.delete(exerciseGifCache).where(eq(exerciseGifCache.exerciseName, entry.name));
  }

  return NextResponse.json({ exercise: entry });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  try {
    await requireAdmin(session?.user?.id ?? "", session?.user?.isAdmin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name");
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  const repo = await getRepository();
  await repo.deleteExercise(name);
  invalidateExerciseMuscleMap();

  await ensureSchema();
  const db = getDb();
  await db.delete(exerciseGifCache).where(eq(exerciseGifCache.exerciseName, name));

  return NextResponse.json({ ok: true });
}
