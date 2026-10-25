import { memo, useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { shiftDateStr } from '@trainingai/shared/date-utils';
import { DEFAULT_WATER_GOAL_ML } from '@trainingai/shared/nutrition/goal-recommendation';
import { homeWidgets } from '../../integrations/widgets/platform';
import { useHealthData } from '../health/data/HealthDataProvider';
import { batterySpec, energySpec, goalsSpec, readinessSpec } from '../health/data/models';
import { useHomeState } from '../home/data/HomeProvider';
import { trainingDays } from '../home/data/models';
import { homeRecommendationModel } from '../home/data/recommendation-model';
import { homeScoreChips } from '../home/data/score-chips';
import { trainingDaySpecs } from '../home/data/training-days';
import { nutritionEnergyModel } from '../nutrition/data/energy-model';
import { useNutrition } from '../nutrition/data/NutritionProvider';
import { recordedIntakeOf } from '../nutrition/data/recorded-intake';
import { usePassiveResource } from '../workouts/data/WorkoutDataProvider';
import { useWorkoutJournal } from '../workouts/logging/WorkoutJournalProvider';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import { useAccountContext } from '../account/AccountProvider';
import { hasContent, snapshotIdentity, widgetSnapshot } from './snapshot';

const DEBOUNCE_MS = 1_000;

/**
 * Keeps the home-screen widget snapshot current (#3268). Passive: it reads only what the app's
 * stores and caches already hold, through the same models Home renders from, and never loads or
 * refreshes anything, so it adds no request at app start. A value not loaded yet stays null, and
 * hasContent() keeps the last snapshot until there is something to draw. It writes about a second
 * after the numbers settle, only when they changed, and at once when the app goes to the
 * background. Renders nothing; mounted only where the native module exists.
 */
export function WidgetSync() {
  const userId = useAccountContext().dataReader?.userId ?? null;
  // Nothing is written while signed out (sign-out clears the snapshot, #3279), and a new account
  // remounts it, so its first snapshot is written even if the numbers happen to match.
  return userId ? <AccountWidgetSync key={userId} userId={userId} /> : null;
}

const AccountWidgetSync = memo(function AccountWidgetSync({ userId }: { userId: string }) {
  const snapshot = useWidgetSnapshot(userId);
  const latest = useRef<{ json: string; identity: string } | null>(null);
  const written = useRef<string | null>(null);
  latest.current = snapshot;

  // Sign-out blocks writes until an account's sync is mounted again (#3279).
  useEffect(() => homeWidgets?.resume(), []);

  useEffect(() => {
    if (!snapshot || snapshot.identity === written.current) return;
    const timer = setTimeout(() => write(latest.current, written), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [snapshot]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') write(latest.current, written);
    });
    return () => subscription.remove();
  }, []);
  return null;
});

function write(
  next: { json: string; identity: string } | null,
  written: { current: string | null },
) {
  if (!homeWidgets || !next || next.identity === written.current) return;
  try {
    homeWidgets.writeSnapshot(next.json);
    written.current = next.identity;
  } catch {
    // The widget keeps the last snapshot, which carries its own date; the next change retries.
  }
}

/** The snapshot as JSON and its identity; a new object only when a model's output changes. */
function useWidgetSnapshot(userId: string) {
  const health = useHealthData();
  const today = health.today;
  const home = useHomeState();
  const workout = useWorkoutContext();
  const journal = useWorkoutJournal();
  const nutrition = useNutrition(today);
  const specs = trainingDaySpecs(today);
  const calendar = usePassiveResource(specs.calendar);
  const lastCalendar = usePassiveResource(specs.lastCalendar);
  const streak = usePassiveResource(specs.streak);
  const readiness = usePassiveResource(readinessSpec(today));
  const battery = usePassiveResource(batterySpec(today));
  const goals = usePassiveResource(goalsSpec);
  const energyState = usePassiveResource(energySpec(today));
  const energyData = energyState.data?.date === today ? energyState.data : null;

  // useHealthData merges the nights afresh on every render, so the chips are keyed on the two
  // nights they can read (nightsKey) rather than on the array.
  const nights = health.sleep.filter((row) => row.date === today || row.date === shiftDateStr(today, -1));
  const nightsKey = JSON.stringify(nights.map((row) => [row.date, row.durationHours, row.provisional]));
  const scores = useMemo(
    () => (readiness.data ? homeScoreChips(readiness.data, nights, today) : null),
    [readiness.data, nightsKey, today],
  );
  const recommendation = useMemo(
    () =>
      homeRecommendationModel({
        catalog: workout.catalog,
        catalogLoading: workout.status === 'loading',
        trained:
          trainingDays(
            [streak.data?.trainedDays, lastCalendar.data?.trainedDays, calendar.data?.trainedDays],
            journal.data.workouts,
          )[today] ?? [],
        active: journal.data.workouts.find((value) => value.status === 'active'),
        restChoice: home.restDays[today],
        mood: home.mood,
        moodFailed: !!home.errors[`mood:${today}`],
        today,
      }),
    [
      workout.catalog,
      workout.status,
      streak.data,
      lastCalendar.data,
      calendar.data,
      journal.data.workouts,
      home.restDays,
      home.mood,
      home.errors,
      today,
    ],
  );
  const energy = useMemo(
    () =>
      nutritionEnergyModel({
        totals: nutrition.view.totals,
        recordedIntake: recordedIntakeOf(nutrition, today, energyData?.balance).intake,
        budgetKcal: energyData?.balance?.budgetKcal,
        targetCalories: nutrition.view.targets.calories,
        targets: nutrition.view.targets,
        scaledTargets: energyData?.macroTargets?.scaled,
      }),
    // The view is rebuilt on every read; the store's data and pending writes are what it comes from.
    [nutrition.data, nutrition.operations, energyData, today],
  );
  const waterMl = health.body?.today?.waterMl ?? null;
  const goalMl = goals.data?.waterGoalMl ?? DEFAULT_WATER_GOAL_ML;
  const identity = useMemo(() => {
    const built = widgetSnapshot({
      user: userId,
      date: today,
      now: new Date(),
      timezone: workout.timezone,
      scores,
      battery: battery.data,
      recommendation,
      energy,
      water: { ml: waterMl, goalMl },
    });
    return hasContent(built) ? { built, identity: snapshotIdentity(built) } : null;
  }, [userId, today, workout.timezone, scores, battery.data, recommendation, energy, waterMl, goalMl]);
  // Keyed on the identity string alone: the same numbers keep the same object, so the write
  // effect does not re-run when only the time would change.
  return useMemo(
    () => (identity ? { json: JSON.stringify(identity.built), identity: identity.identity } : null),
    [identity?.identity],
  );
}
