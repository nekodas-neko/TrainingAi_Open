import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { DEFAULT_WATER_GOAL_ML } from '@trainingai/shared/nutrition/goal-recommendation';
import { homeWidgets } from '../../integrations/widgets/platform';
import { useHealthData } from '../health/data/HealthDataProvider';
import { batterySpec, energySpec, goalsSpec, readinessSpec } from '../health/data/models';
import { useHome } from '../home/data/HomeProvider';
import { homeRecommendationModel } from '../home/data/recommendation-model';
import { homeScoreChips } from '../home/data/score-chips';
import { useTrainingDays } from '../home/data/useTrainingDays';
import { nutritionEnergyModel } from '../nutrition/data/energy-model';
import { useNutrition } from '../nutrition/data/NutritionProvider';
import { useRecordedIntake } from '../nutrition/data/useRecordedIntake';
import { useWorkoutResource } from '../workouts/data/WorkoutDataProvider';
import { useWorkoutJournal } from '../workouts/logging/WorkoutJournalProvider';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import { hasContent, snapshotIdentity, widgetSnapshot, type WidgetSnapshot } from './snapshot';

const DEBOUNCE_MS = 1_000;

/**
 * Keeps the home-screen widget snapshot current (#3268). It reads the same stores and resources
 * Home does, through the same models, and writes about a second after the numbers settle, only
 * when they changed, and at once when the app goes to the background. Renders nothing. Mounted
 * only where the native module exists (Android builds that carry it).
 */
export function WidgetSync() {
  const snapshot = useWidgetSnapshot();
  const identity = snapshotIdentity(snapshot);
  const latest = useRef<{ json: string; identity: string } | null>(null);
  const written = useRef<string | null>(null);
  // Until the app's saved data has loaded there is nothing to draw, and the last snapshot stays.
  latest.current = hasContent(snapshot) ? { json: JSON.stringify(snapshot), identity } : null;

  useEffect(() => {
    if (!latest.current || identity === written.current) return;
    const timer = setTimeout(() => write(latest.current, written), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [identity]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') write(latest.current, written);
    });
    return () => subscription.remove();
  }, []);
  return null;
}

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

function useWidgetSnapshot(): WidgetSnapshot {
  const health = useHealthData();
  const today = health.today;
  const home = useHome();
  const workout = useWorkoutContext();
  const journal = useWorkoutJournal();
  const { days } = useTrainingDays(today);
  const readiness = useWorkoutResource(readinessSpec(today));
  const battery = useWorkoutResource(batterySpec(today));
  const goals = useWorkoutResource(goalsSpec);
  const nutrition = useNutrition(today);
  const energyState = useWorkoutResource(energySpec(today));
  const energyData = energyState.data?.date === today ? energyState.data : null;
  const intake = useRecordedIntake(today, energyData?.balance);
  return widgetSnapshot({
    date: today,
    now: new Date(),
    timezone: workout.timezone,
    scores: readiness.data ? homeScoreChips(readiness.data, health.sleep, today) : null,
    battery: battery.data,
    recommendation: homeRecommendationModel({
      catalog: workout.catalog,
      catalogLoading: workout.status === 'loading',
      trained: days[today] ?? [],
      active: journal.data.workouts.find((value) => value.status === 'active'),
      restChoice: home.restDays[today],
      mood: home.mood,
      moodFailed: !!home.errors[`mood:${today}`],
      today,
    }),
    energy: nutritionEnergyModel({
      totals: nutrition.view.totals,
      recordedIntake: intake.intake,
      budgetKcal: energyData?.balance?.budgetKcal,
      targetCalories: nutrition.view.targets.calories,
      targets: nutrition.view.targets,
      scaledTargets: energyData?.macroTargets?.scaled,
    }),
    water: {
      ml: health.body?.today?.waterMl ?? null,
      goalMl: goals.data?.waterGoalMl ?? DEFAULT_WATER_GOAL_ML,
    },
  });
}
