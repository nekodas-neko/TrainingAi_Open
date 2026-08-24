import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { deleteWorkoutSession } from "@/lib/workout/delete-session";
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One workout-session id.
const MAX_BODY_BYTES = 4 * 1024;

// DELETE — remove a whole workout session and its exercise/set logs (cascade).
export async function DELETE(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const parsed = z.object({ workoutSessionId: z.string().uuid() }).strict().safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { workoutSessionId } = parsed.data;

  try {
    const { deleted, exerciseNames } = await deleteWorkoutSession(userId, workoutSessionId);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const repo = await getRepository();
    for (const name of exerciseNames) {
      await repo.reconcilePersonalRecord(userId, name);
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    reportServerError(e, { userId, url: '/api/workout-sessions' })
    console.error('[workout-sessions DELETE]', e);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
