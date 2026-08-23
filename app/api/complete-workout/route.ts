import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { rateLimit } from "@/lib/rate-limit";
import { CompleteWorkoutPayloadSchema, completeWorkoutFromPayload } from "@trainingai/shared/workout/complete-workout";
import { reportServerError } from "@/lib/observability";
import { syncAndAttributeSessionHr } from "@/lib/workout/post-completion-hr";
import { readJsonLimited } from "@trainingai/shared/http/request-guards";

// A UUID and a timestamp. 4 KB is already far past anything this route can use.
const MAX_BODY_BYTES = 4 * 1024;

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`complete-workout:${userId}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === "too_large"
      ? NextResponse.json({ error: "Request too large" }, { status: 413 })
      : NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CompleteWorkoutPayloadSchema.safeParse(read.body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  let result: { alreadyCompleted: boolean; programSessionId: string | null };
  try {
    result = await completeWorkoutFromPayload(userId, parsed.data);
  } catch (err) {
    // K8: the heaviest offline-first side-effect route reported nothing. A drifted
    // prod-data failure here dead-letters the outbox mutation (K3) with no server
    // trace to correlate — record it before returning the (possibly-misleading) 404.
    reportServerError(err, { userId, url: req.nextUrl.pathname });
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Fire-and-forget: pull this session's Oura HR window, then attribute it to the workout and
  // its sets. Both halves now run in-process — the hr-sync half used to be a POST back to this
  // server's own /api/oura/hr-sync, which failed outright ("fetch failed") 9 times in production
  // and cost a second request worker and pool connection each time (Q-122).
  syncAndAttributeSessionHr(userId, parsed.data.workoutSessionId, session.user.timezone)
    .catch(err => reportServerError(err, { userId, url: '/api/complete-workout#hr-pipeline' }))

  // The next prescription for this session is intentionally NOT generated here — it is
  // generated on demand when the session is next opened (isAiPrescriptionPending), so it is
  // never more than a few minutes stale and never sits waiting for a decision for days
  // (owner ask 2026-07-31: generation should happen right before the workout, not at the
  // end of the previous one).
  return NextResponse.json({ success: true });
}
