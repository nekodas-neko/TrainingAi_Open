import { NextRequest, NextResponse } from "next/server";
import { isNotFoundError } from '@trainingai/shared/errors';
import { routeErrorResponse } from '@/lib/api/route-errors';
import { auth } from "@/auth";
import { rateLimit } from "@/lib/rate-limit";
import { LogExerciseUploadSchema, logExerciseFromPayload } from "@trainingai/shared/workout/log-exercise";
import { reportServerError } from "@/lib/observability";
import { DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { readJsonLimited } from "@trainingai/shared/http/request-guards";

// Measured against LogExerciseUploadSchema at its own limits — every array at 20 entries, every
// string at 200 characters, every number at its largest — a maximal payload is 18,450 bytes, of
// which the per-set answers (#4159) are 676. 64 KB is 3.5 times that. The figure is pinned by
// __tests__/body-cap-comment-4159.test.ts: re-measure before adding a field.
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`log-exercise:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === "too_large"
      ? NextResponse.json({ error: "Request too large" }, { status: 413 })
      : NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = LogExerciseUploadSchema.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ;
  try {
    const result = await logExerciseFromPayload(userId, parsed.data, tz);

    return NextResponse.json({
      success: true,
      workoutSessionId: result.workoutSessionId,
      exerciseLogId:    result.exerciseLogId,
      exercise:         parsed.data.exercise,
      weights:          parsed.data.weights,
      sets:             parsed.data.sets,
      reps:             parsed.data.reps,
      estimated1rm:     result.estimated1rm,
      target80:         result.target80,
      isPR:             result.isPR,
    });
  } catch (err) {
    // Q-462: an ownership refusal is not a server fault. Checked first, so it neither reports 500 to
    // the sync path (which reads 5xx as "retry later" and 4xx as a poison pill to quarantine) nor
    // writes a stack trace into `error_events` — the one fault signal nobody is watching.
    if (isNotFoundError(err)) {
      // Logged, but as a one-line warning rather than a `reportServerError` stack trace: a cross-user
      // attempt is worth seeing in the server log, and is exactly the kind of correctly-refused
      // request that should NOT be filling `error_events`. Dropping the log entirely would trade one
      // problem for a blind spot.
      console.warn(`[log-exercise] refused: ${err.message} (user ${userId}, session ${parsed.data.workoutSessionId})`);
      return routeErrorResponse(err);
    }
    console.error("[log-exercise] logExerciseFromPayload threw", err);
    reportServerError(err, { userId, url: req.nextUrl.pathname });
    return NextResponse.json({ error: "Failed to log exercise" }, { status: 500 });
  }
}
