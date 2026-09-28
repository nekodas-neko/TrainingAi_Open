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

  if (recommendation.session) {
    // RV-78: the two reads are fetched together. Assignments are asked for the UNFILTERED list,
    // because the drop below depends on the prescription and would otherwise serialise them, and
    // then trimmed to what survives the drop, so the response is exactly what it was.
    const [state, assignments] = await Promise.all([
      repo.getSessionPeriodization(userId, recommendation.session.id),
      // Q-115-followup: lets the sore-muscle check-in predict the same whole-session escalation
      // computePerExerciseDeload applies server-side, instead of guessing from the flat
      // muscleGroups list (no main/secondary role information).
      repo.getExerciseMuscleAssignments(recommendation.session.exercises.map(e => e.exerciseName)),
    ]);
    // Reflect a Workout Review "drop this cycle" in the home card's exercise count / duration
    // estimate, matching what the workout screen will actually show.
    const p = state?.prescription;
    if (p?.droppedExerciseIds?.length && state && prescriptionDrivesLoad(p.phaseAction, state.prescriptionStatus)) {
      const dropped = new Set(p.droppedExerciseIds);
      recommendation.session = {
        ...recommendation.session,
        exercises: recommendation.session.exercises.filter(e => !dropped.has(e.id)),
      };
    }
    const kept = new Set(recommendation.session.exercises.map(e => e.exerciseName));
    recommendation.muscleAssignmentsByExercise = Object.fromEntries(
      Object.entries(assignments).filter(([name]) => kept.has(name)),
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
