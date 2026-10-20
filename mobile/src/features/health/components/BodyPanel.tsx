import { useState } from 'react';
import { latestDisplayedBodyFat } from '@trainingai/shared/health/body-fat-display';
import { bmiClassification } from '@trainingai/shared/health/bmi';
import { computeWeightRateKgPerWeek } from '@trainingai/shared/health/long-term-goal-progress';
import { toAestDay } from '@trainingai/shared/date-utils';
import { AppText, Card, Disclosure, FeatureRow, Grid } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { bodyCardColors } from '../../../shared/theme/tokens';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useHealthData } from '../data/HealthDataProvider';
import { goalsSpec, latestMetric, profileSpec, progressSpec } from '../data/models';
import { HealthMetricCard } from './HealthMetricCard';
import { MuscleStatusCard } from './MuscleStatusCard';
import { MetricLogSheet, type LogMetric } from './MetricLogSheet';
import { MetricHistorySheet, type MetricKind } from './MetricHistorySheet';
import { HrDayCard } from './HrDayCard';
import type { HealthDetail } from '../screens/HealthDetailScreen';
import { HrRecoveryProfileCard } from './HrRecoveryProfileCard';
import { TimeInZoneCard, SleepPerformanceCard } from './RecordedHealthCards';
import { useAppleImport } from '../HealthProvider';
import { BodySleepCard } from './BodySleepCard';
import { BodyFatCard, BodyWeightCard, WeightTrendCard } from './BodyWeightCards';
import { LeanMassCard, ScaleCompositionCard } from './BodyCompositionCards';
import { HeartTiles, HrvBaselineCard, TrainingLoadCard } from './BodyHeartCards';
import { ActivityTrendCharts, EnergyBalanceCard, RingCards, WaterCard } from './BodyActivityCards';
import { logSeedReading } from '@trainingai/shared/health/activity-steps';

function GroupTitle({ children }: { children: string }) {
  const { theme } = useTheme();
  return (
    <AppText variant="groupTitle" tone="muted" accessibilityRole="header" style={{ marginTop: theme.spacing.sm }}>
      {children}
    </AppText>
  );
}
export function BodyPanel({ openDetail }: { openDetail: (detail: HealthDetail) => void }) {
  const health = useHealthData();
  const imported = useAppleImport();
  const goals = useWorkoutResource(goalsSpec);
  const profile = useWorkoutResource(profileSpec);
  const progress = useWorkoutResource(progressSpec);
  const [log, setLog] = useState<LogMetric | null>(null);
  const [metric, setMetric] = useState<MetricKind | null>(null);
  const rows = health.body?.recent ?? [];
  const today = health.body?.today;
  const weight = health.body?.latestWeightKg ?? latestMetric(rows, 'weightKg')?.weightKg ?? null;
  const weightDate = health.body?.latestWeightDate ?? latestMetric(rows, 'weightKg')?.date;
  const { value: fat, corrected: fatCorrected } = latestDisplayedBodyFat(rows);
  const { bmi, bmiLabel } = bmiClassification({
    weightKg: weight,
    heightCm: profile.data?.user.heightCm,
    bodyFatPct: fat,
    sex: profile.data?.user.sex,
  });
  const slope = computeWeightRateKgPerWeek(health.body?.weightTrend ?? rows);
  // #3095: the shared seed — body fat's raw reading, and steps' device count, never the
  // treadmill-inclusive figure a save would write back as a manual reading.
  const rawInitial = log && log !== 'waterMl' ? (logSeedReading(log, today) as number | null) : null;
  const targetWeightKg = goals.data?.targetWeightKg ?? null;
  const targetBfPct = goals.data?.targetBfPct ?? null;
  return (
    <>
      <MuscleStatusCard />
      <GroupTitle>Body</GroupTitle>
      <BodyWeightCard
        rows={rows}
        today={health.today}
        weight={weight}
        weightDate={weightDate ?? undefined}
        targetWeightKg={targetWeightKg}
        weightRateKgPerWeek={progress.data?.weightRateKgPerWeek ?? null}
        onLog={() => setLog('weightKg')}
        onOpen={() => setMetric('weightKg')}
      />
      <WeightTrendCard
        rows={rows}
        slope={slope}
        weight={weight}
        fat={fat}
        baselineWeightKg={progress.data?.bodyBaseline.weightKg ?? null}
        baselineBodyFatPct={progress.data?.bodyBaseline.bodyFatPct ?? null}
        targetWeightKg={targetWeightKg}
        targetBfPct={targetBfPct}
      />
      <BodyFatCard
        rows={rows}
        targetBfPct={targetBfPct}
        calibration={health.body?.bodyFatCalibration}
        onOpen={() => setMetric('bodyFat')}
        onLog={() => setLog('bodyFat')}
      />
      <LeanMassCard rows={rows} />
      <ScaleCompositionCard rows={rows} />
      <Grid columns={2}>
        <HealthMetricCard
          compact
          title="Burned"
          value={
            health.body?.activeEnergyKcalToday == null
              ? null
              : Math.round(health.body.activeEnergyKcalToday)
          }
          unit="kcal"
          accent={bodyCardColors.burned}
          caption="From cardio today"
        />
        <HealthMetricCard compact title="BMI" value={bmi} decimals={1} accent={bodyCardColors.bmi}>
          {bmiLabel && (
            <AppText variant="caption" tone="muted">
              {bmiLabel}
              {fat != null
                ? ` · via body fat %${fatCorrected ? ' (DEXA-calibrated)' : ''}`
                : ''}
            </AppText>
          )}
          <Disclosure title="About BMI">
            <AppText variant="caption" tone="muted">
              {fat != null
                ? `Category is based on your body fat %, which is more accurate for muscular builds. Standard BMI categories assume average body composition and classify muscle as excess weight.${fatCorrected ? ' That reading is your scale’s, corrected to your DEXA scan before the category is chosen.' : ''}`
                : 'Weight ÷ height². Standard categories assume average body composition. Log body fat % to get a category adjusted for muscle mass.'}
            </AppText>
          </Disclosure>
        </HealthMetricCard>
      </Grid>
      <GroupTitle>Sleep</GroupTitle>
      <BodySleepCard openDetail={openDetail} />
      <GroupTitle>Heart & recovery</GroupTitle>
      {imported.completed?.hrv && (
        <HealthMetricCard
          title={`HRV · ${imported.completed.hrv.method}`}
          value={imported.completed.hrv.value}
          unit="ms"
          tone="recovery"
          caption={`${toAestDay(new Date(imported.completed.hrv.at), health.timezone)} · ${imported.completed.hrv.source}`}
        />
      )}
      <HeartTiles rows={rows} onOpen={setMetric} onDetails={() => openDetail('heart-rate')} />
      <Card>
        <AppText variant="eyebrow" tone="muted">
          Measure heart rate
        </AppText>
        <AppText variant="caption" tone="muted">
          Live device measurement is deferred. Recorded heart-rate history is available below.
        </AppText>
      </Card>
      <HrDayCard />
      <HrvBaselineCard />
      <TrainingLoadCard />
      <TimeInZoneCard />
      <SleepPerformanceCard />
      <HrRecoveryProfileCard />
      <GroupTitle>Activity & intake</GroupTitle>
      <EnergyBalanceCard />
      <Grid columns={2}>
        <HealthMetricCard
          compact
          title="Steps"
          value={today?.steps ?? null}
          tone="activity"
          onOpen={() => setMetric('steps')}
          onLog={() => setLog('steps')}
          caption="Today"
        />
        <HealthMetricCard
          compact
          title="Distance"
          value={today?.distanceKm ?? null}
          unit="km"
          decimals={1}
          tone="activity"
          caption="Today"
        />
      </Grid>
      <WaterCard
        waterMl={today?.waterMl ?? null}
        goalMl={goals.data?.waterGoalMl ?? null}
        onOpen={() => setMetric('waterMl')}
        onLog={() => setLog('waterMl')}
      />
      <ActivityTrendCharts />
      <RingCards openDetail={openDetail} />
      <FeatureRow
        title="Devices & integrations"
        subtitle="Direct ring connections remain deferred"
      />
      {log && (
        <MetricLogSheet
          key={log}
          field={log}
          initial={rawInitial ?? null}
          onClose={() => setLog(null)}
        />
      )}
      {metric && <MetricHistorySheet key={metric} field={metric} onClose={() => setMetric(null)} />}
    </>
  );
}
