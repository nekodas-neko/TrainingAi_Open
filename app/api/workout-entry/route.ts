import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { editExerciseLog, deleteExerciseLog, ExerciseLogEditSchema } from '@/lib/workout/exercise-log-edits'

// 20 weights and 20 reps plus a few scalars, capped by the schema.
const MAX_BODY_BYTES = 16 * 1024;

// The writes live in `lib/workout/exercise-log-edits.ts`, which the outbox's `exercise_log_edit` /
// `exercise_log_delete` push branches also call (RV-175). This route keeps auth, body limits and the
// HTTP answers, and nothing else.

// PATCH — update weights/reps for an existing exercise log
export async function PATCH(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const parsed = ExerciseLogEditSchema.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    if (!(await editExerciseLog(userId, parsed.data))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    reportServerError(e, { userId, url: '/api/workout-entry' })
    console.error('[workout-entry PATCH]', e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

// DELETE — remove an exercise log and its sets
export async function DELETE(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { exerciseLogId } = (read.body ?? {}) as { exerciseLogId?: string };
  if (!exerciseLogId) return NextResponse.json({ error: "Missing exerciseLogId" }, { status: 400 });
  // RV-47: PATCH gets this from `.uuid()` on its Zod schema; DELETE parses the body by hand and had
  // no guard, so a malformed id reached the ownership check and 500'd on the cast.
  const badId = invalidUuidResponse(exerciseLogId);
  if (badId) return badId;

  try {
    const { found, sessionDeleted } = await deleteExerciseLog(userId, exerciseLogId);
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true, sessionDeleted });
  } catch (e) {
    reportServerError(e, { userId, url: '/api/workout-entry' })
    console.error('[workout-entry DELETE]', e);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
