import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteWorkoutSessionAndReconcile, WorkoutSessionDeleteSchema } from "@/lib/workout/delete-session-reconcile";
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
  const parsed = WorkoutSessionDeleteSchema.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { workoutSessionId } = parsed.data;

  try {
    const { deleted } = await deleteWorkoutSessionAndReconcile(userId, workoutSessionId);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e) {
    reportServerError(e, { userId, url: '/api/workout-sessions' })
    console.error('[workout-sessions DELETE]', e);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
