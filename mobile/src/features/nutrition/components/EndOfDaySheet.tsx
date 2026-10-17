import { prefillEveningScales } from '@trainingai/shared/nutrition/day-checkin-prefill';
import { buildTodayInsight } from '@trainingai/shared/nutrition/day-insight';
import { EVENING_SCALES } from '@trainingai/shared/types/day-checkin';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { z } from 'zod';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  AppButton,
  AppText,
  Card,
  ChoiceScale,
  MarkdownText,
  MultiChoice,
  Sheet,
  Stack,
  StatusIndicator,
  TextField,
} from '../../../shared/ui';
import { HealthViewReady } from '../../health/components/HealthViewReady';
import { useHealthData } from '../../health/data/HealthDataProvider';
import {
  batterySpec,
  energySpec,
  foodTimelineSpec,
  healthDaySpec,
  hrProfileSpec,
  stressSpec,
} from '../../health/data/models';
import { DayReadThrough } from '../../health/screens/HealthDayScreen';
import {
  useWorkoutResource,
  useWorkoutResources,
} from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useNutrition } from '../data/NutritionProvider';
import { STEP_TITLES, visibleReviewSteps } from '../data/review-steps';
import { DayReviewTrends, MealBackfill } from './DayReviewDetails';
import { FoodLogger } from './FoodLogger';
import { DayTotals } from './DayTotals';
import { aiFailureText } from '../../account/api/client';
const scalesSchema = z.object({
  physicalTiredness: z.number().min(1).max(5),
  mentalDrain: z.number().min(1).max(5),
  barelyMoved: z.number().min(1).max(5),
  hydration: z.number().min(1).max(5),
  lateHeavyMeal: z.number().min(1).max(5),
});
const draftSchema = z.object({
  seeded: z.boolean().default(false),
  scales: scalesSchema,
  soreMuscles: z.array(z.string()),
  journal: z.string().max(2000),
  edited: z.boolean(),
});
const initial = {
  seeded: false,
  scales: {
    physicalTiredness: 3,
    mentalDrain: 3,
    barelyMoved: 3,
    hydration: 3,
    lateHeavyMeal: 3,
  },
  soreMuscles: [],
  journal: '',
  edited: false,
};
export function EndOfDaySheet({ date, onClose }: { date: string; onClose: () => void }) {
  const n = useNutrition(date);
  const { theme } = useTheme();
  const health = useHealthData();
  const resources = useWorkoutResources();
  const battery = useWorkoutResource(batterySpec(date), date === n.today);
  const draft = useWorkoutDraft(`evening-checkin:${date}`, draftSchema, initial);
  const [index, setIndex] = useState(0);
  const [logger, setLogger] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [digestError, setDigestError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const steps = visibleReviewSteps({
    mealTypes: n.view.mealTypes,
    loggedMealTypeIds: Object.entries(n.view.mealStatuses)
      .filter(([, status]) => status !== 'not_recorded')
      .map(([id]) => id),
  });
  const position = Math.min(index, steps.length - 1);
  const step = steps[position];
  useEffect(() => {
    void n.store?.refresh('checkin', date);
  }, [n.store, date]);
  useEffect(() => {
    if (!draft.ready || draft.value.edited || draft.value.seeded) {
      return;
    }
    if (!n.loaded.includes('checkin:' + date) && !n.errors['checkin:' + date]) {
      return;
    }
    if (date === n.today && battery.loading && !battery.data && !battery.error) {
      return;
    }
    if (health.connected && !health.body && !health.bodyError && !health.error) {
      return;
    }
    const raw = draftSchema.shape.scales.safeParse(n.view.checkin);
    const journal = z
      .object({
        journal: z.string().nullable().optional(),
        soreMuscles: z.array(z.string()).optional(),
      })
      .passthrough()
      .safeParse(n.view.checkin);
    const body = health.body?.recent.find((row) => row.date === date);
    draft.setValue({
      seeded: true,
      scales: raw.success
        ? raw.data
        : prefillEveningScales({
            batteryLabel: battery.data?.hasData
              ? (battery.data.label as 'Charged' | 'Good' | 'Low' | 'Drained')
              : null,
            steps: body?.steps,
            waterMl: body?.waterMl,
          }),
      journal: journal.success ? (journal.data.journal ?? '') : '',
      soreMuscles: journal.success ? (journal.data.soreMuscles ?? []) : [],
      edited: false,
    });
  }, [
    draft.ready,
    draft.value.seeded,
    n.view.checkin,
    n.loaded,
    n.errors,
    battery.data,
    battery.loading,
    battery.error,
    health.body,
  ]);
  useEffect(() => {
    if (!resources || date !== n.today) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const schema = z.object({ digest: z.string().nullable(), date: z.string() });
        const cached = await resources.draft(`nutrition-day-digest:${date}`, schema);
        if (active && cached) {
          setDigest(cached.digest);
        }
        const response = schema.parse(await resources.connection.post('/api/daily-digest', {}));
        if (response.date !== date) {
          return;
        }
        await resources.saveDraft(`nutrition-day-digest:${date}`, response);
        if (active) {
          setDigest(response.digest);
        }
      } catch (cause) {
        if (active) {
          setDigestError(aiFailureText(cause, 'Could not load the day’s summary.'));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [resources, date]);
  async function save() {
    if (!n.store || busy) {
      return;
    }
    setBusy(true);
    try {
      await n.store.enqueue([
        {
          domain: 'day_checkins',
          date,
          payload: {
            phase: 'evening',
            ...draft.value.scales,
            soreMuscles: draft.value.soreMuscles,
            journal: draft.value.journal.trim() || null,
          },
        },
      ]);
      await resources?.clearDraft(`evening-checkin:${date}`);
      onClose();
    } catch {
      setError('Could not save the review. Your draft is still here.');
    } finally {
      setBusy(false);
    }
  }
  const input = draft.value;
  const insight = buildTodayInsight({
    batteryCurrent: battery.data?.hasData ? battery.data.current : null,
    batteryDrained: battery.data?.hasData ? battery.data.drained : null,
    scales: input.scales,
    soreMuscles: input.soreMuscles,
  });
  return (
    <>
      <Sheet
        visible
        fullHeight
        title={`End of Day · ${STEP_TITLES[step]}`}
        onClose={onClose}
        actions={
          <StatusIndicator
            label="Day review"
            busy={busy || !draft.ready}
            error={error ?? draft.error ?? digestError}
          />
        }
        footer={
          <Stack direction="row">
            {position > 0 && (
              <AppButton
                title="Previous"
                variant="secondary"
                onPress={() => setIndex((i) => Math.max(0, i - 1))}
              />
            )}
            <AppButton
              style={{ flex: 1 }}
              title={position === steps.length - 1 ? 'Save' : 'Next'}
              disabled={!draft.ready}
              busy={busy}
              onPress={() => {
                if (position === steps.length - 1) {
                  void save();
                } else {
                  setIndex((i) => i + 1);
                }
              }}
            />
          </Stack>
        }
      >
        {step === 'day' ? (
          <>
            <Card style={{ height: theme.sizes.chartHeight * 2 }}>
              <AppText variant="eyebrow" tone="muted">
                Your day
              </AppText>
              <ScrollView nestedScrollEnabled style={{ flex: 1 }}>
                {digest ? (
                  <MarkdownText>{digest}</MarkdownText>
                ) : (
                  <AppText tone="muted">
                    {date !== n.today
                      ? 'The daily digest is available for today.'
                      : (digestError ?? 'Preparing your day’s summary…')}
                  </AppText>
                )}
              </ScrollView>
            </Card>
            <Card>
              <AppText variant="heading">Today’s totals</AppText>
              <DayTotals
                date={date}
                battery={
                  battery.data?.hasData
                    ? {
                        current: battery.data.current,
                        label: battery.data.label,
                        drained: battery.data.drained,
                      }
                    : null
                }
              />
            </Card>
            <DayReviewTrends date={date} />
            <HealthViewReady
              view="day"
              requests={[
                healthDaySpec(date),
                energySpec(date),
                stressSpec(date),
                foodTimelineSpec(date),
                hrProfileSpec,
              ]}
            >
              <DayReadThrough date={date} readOnly />
            </HealthViewReady>
          </>
        ) : step === 'meals' ? (
          <>
            <AppText tone="muted">Anything missed?</AppText>
            <MealBackfill date={date} onManual={setLogger} />
          </>
        ) : (
          <>
            {EVENING_SCALES.map((scale) => (
              <Stack key={scale.key}>
                <AppText variant="label">{scale.label}</AppText>
                <ChoiceScale
                  label={scale.label}
                  value={input.scales[scale.key]}
                  options={[1, 2, 3, 4, 5].map((value) => ({
                    value,
                    label: String(value),
                    description:
                      value === 1 ? scale.low : value === 5 ? scale.high : 'In between',
                  }))}
                  onChange={(value) =>
                    draft.setValue({
                      ...input,
                      edited: true,
                      scales: { ...input.scales, [scale.key]: value },
                    })
                  }
                />
                <Stack direction="row" justify="space-between">
                  <AppText variant="micro" tone="muted">
                    {scale.low}
                  </AppText>
                  <AppText variant="micro" tone="muted">
                    {scale.high}
                  </AppText>
                </Stack>
              </Stack>
            ))}
            <MultiChoice
              label="Sore muscles"
              value={input.soreMuscles}
              options={[
                'Chest',
                'Back',
                'Shoulders',
                'Biceps',
                'Triceps',
                'Core',
                'Quads',
                'Hamstrings',
                'Glutes',
                'Calves',
              ].map((value) => ({ value, label: value }))}
              onChange={(soreMuscles) =>
                draft.setValue({ ...input, soreMuscles, edited: true })
              }
            />
            <TextField
              label="Journal (optional)"
              multiline
              value={input.journal}
              onChangeText={(journal) => draft.setValue({ ...input, journal, edited: true })}
            />
            <Card tone="recovery">
              <AppText variant="eyebrow">Connecting the dots</AppText>
              <AppText>{insight}</AppText>
            </Card>
          </>
        )}
      </Sheet>
      {logger && (
        <FoodLogger
          date={date}
          mealTypeId={logger}
          onClose={() => setLogger(null)}
          onRecipes={() => setLogger(null)}
        />
      )}
    </>
  );
}
