import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { estimateProgramSessionMin } from "@trainingai/shared/workout/program-session-duration";
import { prescriptionDrivesLoad } from "@trainingai/shared/ai-periodization/apply-prescription";
import { serveStoredPrescription } from "@trainingai/shared/ai-periodization/program-phase";
import { fitStoredPlanToCheckinBudget } from "@trainingai/shared/ai-periodization/checkin-plan-budget";
import { adoptPendingAiPlan } from "@trainingai/shared/ai-periodization/pending-plan-adoption";

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
    const [state, assignments, styles, equipmentByName] = await Promise.all([
      // #3890: in the applies-to week, the weekly check-in's shorter session (no model call).
      repo.getSessionPeriodization(userId, recommendation.session.id)
        .then(st => st && fitStoredPlanToCheckinBudget(userId, recommendation.session!.id, repo, tz, st))
        // #3900 review (H): a plan left `pending` from before the AI plan applied every plan by itself.
        .then(st => st && adoptPendingAiPlan(userId, recommendation.session!.id, repo, tz, recommendation.program, st)),
      // Q-115-followup: lets the sore-muscle check-in predict the same whole-session escalation
      // computePerExerciseDeload applies server-side, instead of guessing from the flat
      // muscleGroups list (no main/secondary role information).
      repo.getExerciseMuscleAssignments(recommendation.session.exercises.map(e => e.exerciseName)),
      // The card's "~N min" (#2362): the prescription's own estimate when one drives the session,
      // else the duration model over the program's styles — never exercises × a constant.
      repo.listProgressionStyles(userId),
      repo.getExerciseEquipment(recommendation.session.exercises.map(e => e.exerciseName)),
    ]);
    // Reflect a Workout Review "drop this cycle" in the home card's exercise count / duration
    // estimate, matching what the workout screen will actually show.
    // #3716: an aged-out prescription is not the plan (#3700), so neither its drops nor its
    // duration reach the Home card. Opening the session regenerates it. #3907: nor does a plan whose
    // deload has ended (#3876), by the same served-plan check as the card's read.
    const served = state ? await serveStoredPrescription(repo, userId, recommendation.program, state, tz) : null;
    const p = served?.prescription;
    const drives = !!p && !!served && prescriptionDrivesLoad(p.phaseAction, served.prescriptionStatus);
    if (drives && p.droppedExerciseIds?.length) {
      const dropped = new Set(p.droppedExerciseIds);
      recommendation.session = {
        ...recommendation.session,
        exercises: recommendation.session.exercises.filter(e => !dropped.has(e.id)),
      };
    }
    recommendation.estimatedDurationMin = drives && p.estimatedSessionDurationMin > 0
      ? p.estimatedSessionDurationMin
      : estimateProgramSessionMin(
          recommendation.session.exercises,
          new Map(styles.map(st => [st.id, st.sets])),
          name => equipmentByName[name],
        );
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
