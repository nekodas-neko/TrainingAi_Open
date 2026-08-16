import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { rateLimit } from "@/lib/rate-limit";
import { LogExercisePayloadSchema, logExerciseFromPayload } from "@trainingai/shared/workout/log-exercise";
import { reportServerError } from "@/lib/observability";
import { DEFAULT_TZ } from "@trainingai/shared/date-utils";

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`log-exercise:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = LogExercisePayloadSchema.safeParse(rawBody);
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
    console.error("[log-exercise] logExerciseFromPayload threw", err);
    reportServerError(err, { userId, url: req.nextUrl.pathname });
    return NextResponse.json({ error: "Failed to log exercise" }, { status: 500 });
  }
}
