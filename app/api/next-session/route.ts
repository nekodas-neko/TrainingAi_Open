import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { prescriptionDrivesLoad } from "@trainingai/shared/ai-periodization/apply-prescription";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tz = session.user?.timezone ?? DEFAULT_TZ;
  const repo = await getRepository();
  const recommendation = await repo.getNextSession(userId, tz);

  // Reflect a Workout Review "drop this cycle" in the home card's exercise count / duration
  // estimate, matching what the workout screen will actually show.
  if (recommendation.session) {
    const state = await repo.getSessionPeriodization(userId, recommendation.session.id);
    const p = state?.prescription;
    if (p?.droppedExerciseIds?.length && state && prescriptionDrivesLoad(p.phaseAction, state.prescriptionStatus)) {
      const dropped = new Set(p.droppedExerciseIds);
      recommendation.session = {
        ...recommendation.session,
        exercises: recommendation.session.exercises.filter(e => !dropped.has(e.id)),
      };
    }
    // Q-115-followup: lets the sore-muscle check-in predict the same whole-session escalation
    // computePerExerciseDeload applies server-side, instead of guessing from the flat
    // muscleGroups list (no main/secondary role information).
    recommendation.muscleAssignmentsByExercise = await repo.getExerciseMuscleAssignments(
      recommendation.session.exercises.map(e => e.exerciseName),
    );
  }

  // RV-82: `program` is server-internal — it exists so the two routes that used to re-fetch it can
  // read it off the recommendation. This route serialises the recommendation WHOLESALE, so leaving
  // it on would grow the home card's most-fetched response by the entire active program: every
  // session, every exercise, the schedule. Stripped rather than made opt-in, because the default
  // for a wholesale `NextResponse.json` has to be the safe one.
  const { program: _program, ...body } = recommendation;
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
