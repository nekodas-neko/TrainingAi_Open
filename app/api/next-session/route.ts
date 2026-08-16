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

  return NextResponse.json(recommendation, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
