import {
  TEMPERATURE_DEVIATION_LABEL,
  TEMPERATURE_DEVIATION_NOTE,
  ouraTemperatureDeviationRow,
} from '@trainingai/shared/format/temperature-deviation';
import { useMemo, useState } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import {
  shiftDateStr,
  weekStartForDay,
  formatDateDisplay,
  clockSkipOnDay,
  dateStrMidnightInTz,
} from '@trainingai/shared/date-utils';
import {
  AppText,
  Card,
  Grid,
  IconButton,
  KeyValueGrid,
  LineChart,
  MetricTile,
  PageLayout,
  Stack,
  StatusIndicator,
  TabPanel,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { HistoryDay } from '../../workouts/screens/WorkoutHistoryScreen';
import { hrTracePoints } from '../data/hr-trace';
import { useHealthData } from '../data/HealthDataProvider';
import {
  energySpec,
  foodTimelineSpec,
  healthDaySpec,
  healthDaySchema,
  hrProfileSpec,
  displayFat,
  metricValue,
  stressSpec,
} from '../data/models';
import { HealthViewReady } from '../components/HealthViewReady';
import { SleepNight } from '../components/SleepNight';
import { StressDayCard } from '../components/StressDayCard';
import { ActivityDay } from '../components/ActivityDay';
import { EnergyDay } from '../components/EnergyDay';
export function HealthDayScreen({
  initialDate,
  onBack,
}: {
  initialDate: string;
  onBack: () => void;
}) {
  const { theme } = useTheme();
  const { today } = useHealthData();
  const [date, setDate] = useState(initialDate);
  const state = useWorkoutResource(healthDaySpec(date));
  const parsed = healthDaySchema.safeParse(state.data);
  const data = parsed.success ? parsed.data : null;
  const days = Array.from({ length: 7 }, (_, i) => shiftDateStr(weekStartForDay(date), i));
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 25 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
        onPanResponderRelease: (_, gesture) => {
          if (Math.abs(gesture.dx) > 50) {
            setDate((previous) => {
              const next = shiftDateStr(previous, gesture.dx < 0 ? 1 : -1);
              return next <= today ? next : previous;
            });
          }
        },
      }),
    [today],
  );
  return (
    <PageLayout
      title={formatDateDisplay(date, 'long')}
      onBack={onBack}
      header={
        <Stack direction="row" align="center">
          <IconButton icon="back" label="Back to Health" onPress={onBack} />
          <AppText variant="heading" style={{ flex: 1, textAlign: 'center' }}>
            {formatDateDisplay(date, 'long')}
          </AppText>
          <StatusIndicator
            label="Day records"
            busy={state.loading}
            error={state.error}
            onRetry={state.refresh}
          />
        </Stack>
      }
    >
      <Stack direction="row" gap="xs" style={{ paddingHorizontal: theme.spacing.lg }}>
        {days.map((day, i) => (
          <Pressable
            key={day}
            disabled={day > today}
            accessibilityRole="button"
            accessibilityLabel={day}
            accessibilityState={{ selected: day === date, disabled: day > today }}
            onPress={() => setDate(day)}
            style={{
              flex: 1,
              minHeight: theme.sizes.button,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radii.control,
              backgroundColor: day === date ? theme.colors.raised : 'transparent',
              opacity: day > today ? 0.3 : 1,
            }}
          >
            <AppText variant="micro" tone="muted">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}
            </AppText>
            <AppText variant="label">{Number(day.slice(8))}</AppText>
          </Pressable>
        ))}
      </Stack>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <Grid columns={4}>
          {[
            { label: 'Readiness', value: data?.scores?.readiness, color: theme.colors.brand },
            {
              label: 'HR',
              value: data?.bodyMeta?.restingHeartRate,
              color: theme.tones.heart.foreground,
            },
            {
              label: 'Sleep',
              value: data?.scores?.sleep,
              color: theme.tones.sleep.foreground,
            },
            {
              label: 'Move',
              value: data?.scores?.activity,
              color: theme.tones.nutrition.foreground,
            },
          ].map((row) => (
            <Stack key={row.label} align="center">
              <AppText variant="title" style={{ color: row.color }}>
                {metricValue(row.value)}
              </AppText>
              <AppText variant="micro" tone="muted">
                {row.label}
              </AppText>
            </Stack>
          ))}
        </Grid>
      </View>
      <View style={{ flex: 1, paddingHorizontal: theme.spacing.lg }} {...swipe.panHandlers}>
        <TabPanel key={date} refreshing={state.refreshing} onRefresh={state.refresh}>
          <HealthViewReady
            view="day"
            requests={[
              healthDaySpec(date),
              energySpec(date),
              foodTimelineSpec(date),
              hrProfileSpec,
              ...(date <= today ? [stressSpec(date)] : []),
            ]}
          >
            <DayReadThrough date={date} />
          </HealthViewReady>
        </TabPanel>
      </View>
    </PageLayout>
  );
}
export function DayReadThrough({
  date,
  readOnly = false,
}: {
  date: string;
  readOnly?: boolean;
}) {
  const { today, timezone } = useHealthData();
  const state = useWorkoutResource(healthDaySpec(date));
  const energy = useWorkoutResource(energySpec(date));
  const parsed = healthDaySchema.safeParse(state.data);
  const data = parsed.success ? parsed.data : null;
  const body = data?.bodyMeta;
  if (!data) {
    return (
      <>
        <AppText tone="muted">
          The day's server records could not be loaded. Use the header to retry.
        </AppText>
        <ActivityDay logs={[]} date={date} />
      </>
    );
  }
  const rows = body
    ? (
        [
          ['bodyFatCorrected', 'Body fat', '%'],
          ['skeletalMusclePct', 'Skeletal muscle', '%'],
          ['muscleMassKg', 'Muscle mass', 'kg'],
          ['bodyWaterPct', 'Body water', '%'],
          ['visceralFatIndex', 'Visceral fat', ''],
          ['boneMassKg', 'Bone mass', 'kg'],
          ['proteinPct', 'Protein', '%'],
          ['bmrKcal', 'BMR', 'kcal'],
          ['metabolicAge', 'Metabolic age', 'yr'],
          ['subcutaneousFatPct', 'Subcut. fat', '%'],
          ['fatFreeMassKg', 'Fat-free mass', 'kg'],
          ['restingHeartRate', 'Resting HR', 'bpm'],
          ['hrvMs', 'HRV', 'ms'],
          ['spo2Pct', 'SpO₂', '%'],
          ['steps', 'Steps', ''],
          ['distanceKm', 'Distance', 'km'],
        ] as const
      ).flatMap(([key, label, unit]) => {
        const value = key === 'bodyFatCorrected' ? displayFat(body) : body[key];
        return value != null
          ? [
              {
                label,
                value: metricValue(value, unit, key === 'steps' || key === 'bmrKcal' ? 0 : 1),
              },
            ]
          : [];
      })
    : [];
  // The trace is on wall-clock minutes (#3442); a spring-forward day's skipped hour is not a gap (#3445).
  const skip = clockSkipOnDay(dateStrMidnightInTz(date, timezone).getTime(), timezone);
  const points = hrTracePoints(
    data.hr.map((p) => ({ x: p.minute, y: p.bpm })),
    skip,
  );
  const tempDeviation = ouraTemperatureDeviationRow(data.bodyTemp);
  return (
    <>
      {!!data.exercises.length && (
        <HistoryDay
          compact
          readOnly={readOnly}
          embedded
          date={date}
          sessionEnergy={energy.data?.activeBreakdown?.workoutKcalBySession}
        />
      )}
      <ActivityDay logs={data.activityLogs} date={date} />
      <EnergyDay date={date} energy={energy.data} hr={data.hr} />
      {data.sleep && <SleepNight compact night={{ ...data.sleep, date }} />}
      {tempDeviation && (
        <Card>
          <KeyValueGrid
            rows={[
              {
                label: TEMPERATURE_DEVIATION_LABEL,
                value: tempDeviation.value,
              },
            ]}
          />
          <AppText variant="caption" tone="muted">
            {TEMPERATURE_DEVIATION_NOTE}
          </AppText>
        </Card>
      )}
      {data.bodyTemp?.meanC != null && (
        <Card>
          <KeyValueGrid
            rows={[
              { label: 'Body temp', value: metricValue(data.bodyTemp.meanC, '°C', 1) },
              ...(data.bodyTemp.devC != null
                ? [{ label: 'vs usual', value: metricValue(data.bodyTemp.devC, '°C', 2) }]
                : []),
            ]}
          />
        </Card>
      )}
      {data.hr.length > 1 && (
        <Card>
          <AppText variant="eyebrow" tone="muted">
            Heart rate through the day
          </AppText>
          <LineChart
            points={points}
            xDomain={[0, 1440]}
            axisLabels={['00:00', '12:00', '24:00']}
            label="Day heart rate"
            tone="heart"
          />
          <KeyValueGrid
            rows={[
              {
                label: 'Low',
                value: metricValue(Math.min(...data.hr.map((p) => p.bpm)), 'bpm'),
              },
              {
                label: 'High',
                value: metricValue(Math.max(...data.hr.map((p) => p.bpm)), 'bpm'),
              },
            ]}
          />
          <AppText variant="micro" tone="muted">
            15-minute averages
          </AppText>
        </Card>
      )}
      {body && (body.weightKg != null || rows.length > 0) && (
        <Card>
          <AppText variant="eyebrow" tone="muted">
            Body composition
          </AppText>
          {body.weightKg != null && (
            <AppText variant="title">{metricValue(body.weightKg, 'kg', 1)}</AppText>
          )}
          <KeyValueGrid rows={rows} />
        </Card>
      )}
      {!data.exercises.length &&
        !data.activityLogs.length &&
        !body &&
        !data.sleep &&
        !data.hr.length && <AppText tone="muted">Nothing logged on this day.</AppText>}
      <StressDayCard date={date} enabled={date <= today} />
    </>
  );
}
