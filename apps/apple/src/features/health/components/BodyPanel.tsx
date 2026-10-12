import { HealthResourceHeader } from './HealthResourceHeader';
import { useState } from 'react';
import { bodyComposition } from '@trainingai/shared/health/body-composition';
import {
  computeWeightRateKgPerWeek,
  goalProgressPct,
} from '@trainingai/shared/health/long-term-goal-progress';
import { scoreBand } from '@trainingai/shared/health/score-band';
import { formatHoursMinutes } from '@trainingai/shared/format/units';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  Disclosure,
  FeatureRow,
  Grid,
  ListRow,
  MetricTile,
  ProgressBar,
  Stack,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { ResourceStatus } from '../../workouts/components/ResourceStatus';
import { useHealthData } from '../data/HealthDataProvider';
import {
  displayFat,
  energySpec,
  goalsSpec,
  latestMetric,
  loadSpec,
  metricValue,
  readinessSpec,
  profileSpec,
  progressSpec,
} from '../data/models';
import { HealthMetricCard } from './HealthMetricCard';
import { MuscleStatusCard } from './MuscleStatusCard';
import { MetricLogSheet, type LogMetric } from './MetricLogSheet';
import { MetricHistorySheet, type MetricKind } from './MetricHistorySheet';
import { HrDayCard } from './HrDayCard';
import type { HealthDetail } from '../screens/HealthDetailScreen';
import {
  TimeInZoneCard,
  SleepPerformanceCard,
  NutritionActivityTrends,
} from './RecordedHealthCards';
import { RingStatusCard } from './RecordedHealthCards';

function GroupTitle({ children }: { children: string }) {
  return (
    <AppText variant="eyebrow" tone="muted">
      {children}
    </AppText>
  );
}
export function BodyPanel({
  openDetail,
  openData,
}: {
  openDetail: (detail: HealthDetail) => void;
  openData: () => void;
}) {
  const health = useHealthData();
  const goals = useWorkoutResource(goalsSpec);
  const profile = useWorkoutResource(profileSpec);
  const progress = useWorkoutResource(progressSpec);
  const readiness = useWorkoutResource(readinessSpec(health.today));
  const energy = useWorkoutResource(energySpec(health.today));
  const load = useWorkoutResource(loadSpec);
  const [log, setLog] = useState<LogMetric | null>(null);
  const [metric, setMetric] = useState<MetricKind | null>(null);
  const rows = health.body?.recent ?? [];
  const today = health.body?.today;
  const weight =
    health.body?.latestWeightKg ?? latestMetric(rows, 'weightKg')?.weightKg ?? null;
  const weightDate = health.body?.latestWeightDate ?? latestMetric(rows, 'weightKg')?.date;
  const fatRow = rows.find((row) => displayFat(row) !== null);
  const fat = displayFat(fatRow);
  const pairedRows = rows.filter((row) => row.weightKg !== null && displayFat(row) !== null);
  const paired = pairedRows[0];
  const composition = bodyComposition(paired?.weightKg, displayFat(paired));
  const height = profile.data?.user.heightCm;
  const bmi =
    weight !== null && height != null && height > 0 ? weight / (height / 100) ** 2 : null;
  const bmiLabel =
    bmi === null
      ? null
      : fat != null
        ? profile.data?.user.sex === 'female'
          ? fat < 14
            ? 'Essential fat'
            : fat < 21
              ? 'Athletic'
              : fat < 25
                ? 'Fitness'
                : fat < 32
                  ? 'Average'
                  : 'High fat'
          : fat < 6
            ? 'Essential fat'
            : fat < 14
              ? 'Athletic'
              : fat < 18
                ? 'Fitness'
                : fat < 25
                  ? 'Average'
                  : 'High fat'
        : bmi < 18.5
          ? 'Underweight'
          : bmi < 25
            ? 'Normal'
            : bmi < 30
              ? 'Overweight'
              : 'Obese';
  const hrvDeviation =
    readiness.data?.baselineHrv != null &&
    readiness.data.baselineHrv > 0 &&
    readiness.data.recentHrv != null
      ? Math.round(
          ((readiness.data.recentHrv - readiness.data.baselineHrv) /
            readiness.data.baselineHrv) *
            100,
        )
      : null;
  const slope = computeWeightRateKgPerWeek(health.body?.weightTrend ?? rows);
  const lastNight = health.sleep.find((row) => row.date === health.today);
  const rawInitial =
    log === 'bodyFat' ? today?.bodyFat : log && log !== 'waterMl' ? today?.[log] : null;
  return (
    <>
      <MuscleStatusCard />
      <GroupTitle>Body</GroupTitle>
      <HealthMetricCard
        title="Body Weight"
        value={weight}
        unit="kg"
        decimals={1}
        tone="recovery"
        caption={
          weightDate !== health.today && weightDate
            ? `Last logged ${weightDate}`
            : 'Last 7 days'
        }
        onLog={() => setLog('weightKg')}
        onOpen={() => setMetric('weightKg')}
        points={[...rows]
          .reverse()
          .map((row) => ({ label: row.date, value: row.weightKg, x: Date.parse(row.date) }))}
      >
        {goals.data?.targetWeightKg !== null && goals.data?.targetWeightKg !== undefined && (
          <AppText variant="caption" tone="muted">
            Goal {metricValue(goals.data.targetWeightKg, 'kg', 1)}
          </AppText>
        )}
      </HealthMetricCard>
      <HealthMetricCard
        title="Weight Trend"
        value={slope}
        unit="kg/wk"
        decimals={2}
        caption="Last 30 days"
      >
        <Disclosure title="About this trend">
          <AppText variant="caption" tone="muted">
            Change across your dated weight readings. At least three readings are needed.
          </AppText>
        </Disclosure>
        {weight !== null &&
          progress.data?.bodyBaseline.weightKg != null &&
          goals.data?.targetWeightKg != null && (
            <>
              <AppText variant="caption">
                Weight {weight} → {goals.data.targetWeightKg} kg
              </AppText>
              <ProgressBar
                value={
                  goalProgressPct(
                    progress.data.bodyBaseline.weightKg,
                    weight,
                    goals.data.targetWeightKg,
                  ) / 100
                }
              />
            </>
          )}
        {fat !== null &&
          progress.data?.bodyBaseline.bodyFatPct != null &&
          goals.data?.targetBfPct != null && (
            <>
              <AppText variant="caption">
                Body fat {fat} → {goals.data.targetBfPct}%
              </AppText>
              <ProgressBar
                value={
                  goalProgressPct(
                    progress.data.bodyBaseline.bodyFatPct,
                    fat,
                    goals.data.targetBfPct,
                  ) / 100
                }
              />
            </>
          )}
      </HealthMetricCard>
      {fat !== null && (
        <HealthMetricCard
          title="Body Fat"
          value={fat}
          unit="%"
          decimals={1}
          tone="nutrition"
          onOpen={() => setMetric('bodyFat')}
          onLog={() => setLog('bodyFat')}
          points={[...rows].reverse().map((row) => ({
            label: row.date,
            value: displayFat(row),
            x: Date.parse(row.date),
          }))}
        >
          {fatRow?.bodyFatIsCorrected && <Badge label="DEXA corrected" />}
          {health.body?.bodyFatCalibration?.offsetPct != null && (
            <AppText variant="micro" tone="muted">
              DEXA-corrected {health.body.bodyFatCalibration.offsetPct >= 0 ? '+' : ''}
              {health.body.bodyFatCalibration.offsetPct.toFixed(1)}% ·{' '}
              {health.body.bodyFatCalibration.pairCount ?? '—'} scans compared
            </AppText>
          )}
          {rows.some((row) => row.bodyFatIsCorrected) &&
            rows.some((row) => row.bodyFat != null && !row.bodyFatIsCorrected) && (
              <AppText variant="micro" tone="muted">
                Earlier readings are on another instrument; only calibrated readings are
                corrected.
              </AppText>
            )}
        </HealthMetricCard>
      )}
      {composition && pairedRows.length >= 2 && (
        <Card>
          <AppText variant="eyebrow" tone="muted">
            Body Composition
          </AppText>
          <Grid columns={2}>
            <MetricTile label="Fat mass" value={metricValue(composition.fatMassKg, 'kg', 1)} />
            <MetricTile label="Lean mass" value={metricValue(composition.ffmKg, 'kg', 1)} />
          </Grid>
          <AppText variant="caption" tone="muted">
            Derived from weight and body fat on {paired.date} · estimated BMR{' '}
            {metricValue(composition.bmrKcal, 'kcal')}
          </AppText>
        </Card>
      )}
      {rows.some((row) => row.skeletalMusclePct !== null) && (
        <Card>
          <AppText variant="eyebrow" tone="muted">
            Body Composition
          </AppText>
          <Grid columns={2}>
            {(
              [
                ['skeletalMusclePct', 'Skeletal muscle', '%'],
                ['bodyWaterPct', 'Body water', '%'],
                ['muscleMassKg', 'Muscle mass', 'kg'],
                ['boneMassKg', 'Bone mass', 'kg'],
                ['visceralFatIndex', 'Visceral fat', ''],
                ['metabolicAge', 'Metabolic age', ''],
              ] as const
            ).map(([field, label, unit]) => {
              const row = latestMetric(rows, field);
              return (
                <MetricTile
                  key={field}
                  label={label}
                  value={metricValue(row?.[field], unit, 1)}
                  caption={row?.date}
                />
              );
            })}
          </Grid>
        </Card>
      )}
      <Grid columns={2}>
        <HealthMetricCard
          compact
          title="Burned"
          value={health.body?.activeEnergyKcalToday}
          unit="kcal"
          tone="activity"
          caption="Active energy · today"
        />
        <HealthMetricCard compact title="BMI" value={bmi} decimals={1} tone="nutrition">
          {bmiLabel && (
            <AppText variant="caption" tone="muted">
              {bmiLabel}
              {fat != null
                ? ` · via body fat %${fatRow?.bodyFatIsCorrected ? ' (DEXA-calibrated)' : ''}`
                : ''}
            </AppText>
          )}
          <Disclosure title="About BMI">
            <AppText variant="caption" tone="muted">
              {fat != null
                ? 'Category is based on your body fat %, which accounts for muscular builds. Standard BMI categories assume average body composition and classify muscle as excess weight.'
                : 'Weight ÷ height². Standard categories assume average body composition.'}
            </AppText>
          </Disclosure>
        </HealthMetricCard>
      </Grid>
      <GroupTitle>Sleep</GroupTitle>
      <HealthMetricCard
        title="Sleep"
        tone="sleep"
        onOpen={() => openDetail('sleep')}
        caption={
          lastNight
            ? lastNight.date
            : health.sleep[0]
              ? `Last recorded ${health.sleep[0].date}`
              : 'No night recorded today'
        }
      >
        <AppText variant="title">
          {lastNight?.durationHours != null
            ? formatHoursMinutes(lastNight.durationHours * 60)
            : '—'}
        </AppText>
        {lastNight?.provisional && <Badge label="Still updating" tone="sleep" />}
        {lastNight?.manualEntry && <Badge label="Logged by hand" tone="sleep" />}
        {lastNight && (
          <Stack direction="row" wrap>
            {(
              [
                ['deepSleepHours', 'Deep'],
                ['remSleepHours', 'REM'],
                ['lightSleepHours', 'Light'],
                ['awakHours', 'Awake'],
              ] as const
            )
              .filter(([field]) => lastNight[field] !== null)
              .map(([field, title]) => (
                <Badge
                  key={field}
                  tone="sleep"
                  label={`${title} ${formatHoursMinutes(lastNight[field]! * 60)}`}
                />
              ))}
          </Stack>
        )}
        {health.sleepError && (
          <AppText tone="muted" variant="caption">
            {health.sleepError}
          </AppText>
        )}
        <AppButton
          title="Sleep details →"
          variant="ghost"
          onPress={() => openDetail('sleep')}
        />
      </HealthMetricCard>
      <GroupTitle>Heart & recovery</GroupTitle>
      <Grid columns={3}>
        {(['restingHeartRate', 'hrvMs', 'spo2Pct'] as const).map((field) => {
          const row = latestMetric(rows, field);
          const title =
            field === 'restingHeartRate' ? 'Resting HR' : field === 'hrvMs' ? 'HRV' : 'SpO₂';
          return (
            <HealthMetricCard
              key={field}
              compact
              title={title}
              value={row?.[field] ?? null}
              unit={field === 'hrvMs' ? 'ms' : field === 'spo2Pct' ? '%' : 'bpm'}
              tone={field === 'spo2Pct' ? 'recovery' : 'heart'}
              caption={row?.date}
              onOpen={() => setMetric(field)}
            />
          );
        })}
      </Grid>
      <AppButton
        title="Heart rate details →"
        variant="ghost"
        onPress={() => openDetail('heart-rate')}
      />
      <Card>
        <AppText variant="eyebrow" tone="muted">
          Measure heart rate
        </AppText>
        <AppText variant="caption" tone="muted">
          Live device measurement is deferred. Recorded heart-rate history is available below.
        </AppText>
      </Card>
      <HrDayCard />
      {hrvDeviation !== null && (
        <HealthMetricCard
          title="HRV · 7d vs 28d baseline"
          value={hrvDeviation}
          unit="%"
          tone="heart"
          caption={`${scoreBand(70 + 2 * hrvDeviation).label} · ${metricValue(readiness.data?.recentHrv, 'ms')} recent vs ${metricValue(readiness.data?.baselineHrv, 'ms')} baseline`}
        />
      )}
      <HealthMetricCard
        title="Training Load"
        value={load.data?.acwr}
        decimals={2}
        caption={load.data?.interpretation.replace(/_/g, ' ')}
        status={
          <ResourceStatus inline label="Training Load" state={load} refresh={load.refresh} />
        }
      >
        {load.data && (
          <Grid columns={2}>
            <MetricTile label="Acute load" value={metricValue(load.data.acuteLoad, 'kg')} />
            <MetricTile label="Chronic load" value={metricValue(load.data.chronicLoad, 'kg')} />
          </Grid>
        )}
      </HealthMetricCard>
      <TimeInZoneCard />
      <SleepPerformanceCard />
      <FeatureRow
        title="Heart-rate recovery profile"
        subtitle="Deferred with workout heart-rate integration"
      />
      <GroupTitle>Activity & intake</GroupTitle>
      <Card>
        <HealthResourceHeader title={'Energy Budget'} state={energy} refresh={energy.refresh} />

        {energy.data?.balance ? (
          <>
            <AppText variant="title">
              {metricValue(energy.data.balance.remainingKcal, 'kcal')} remaining
            </AppText>
            <Grid columns={2}>
              <MetricTile
                label="Intake"
                value={metricValue(energy.data.balance.intakeKcal, 'kcal')}
                tone="nutrition"
              />
              <MetricTile
                label="Expenditure"
                value={metricValue(energy.data.balance.expenditureKcal, 'kcal')}
                tone="activity"
              />
            </Grid>
            <AppText variant="caption" tone="muted">
              {energy.data.balance.zoneLabel}
            </AppText>
          </>
        ) : (
          energy.data && (
            <AppText variant="caption" tone="muted">
              {energy.data.missingProfileFields.length
                ? `Needed in profile: ${energy.data.missingProfileFields.join(', ')}`
                : 'No energy budget available yet'}
            </AppText>
          )
        )}
      </Card>
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
          title="Dist"
          value={today?.distanceKm ?? null}
          unit="km"
          decimals={1}
          tone="activity"
          caption="Today"
        />
      </Grid>
      <HealthMetricCard
        title="Water Intake"
        value={today?.waterMl ?? null}
        unit="ml"
        tone="recovery"
        onOpen={() => setMetric('waterMl')}
        onLog={() => setLog('waterMl')}
      >
        {goals.data?.waterGoalMl != null && today?.waterMl != null && (
          <ProgressBar value={today.waterMl / goals.data.waterGoalMl} />
        )}
      </HealthMetricCard>
      <NutritionActivityTrends />
      <GroupTitle>Ring</GroupTitle>
      <RingStatusCard />
      <FeatureRow
        title="Devices & integrations"
        subtitle="Direct ring connections remain deferred"
      />
      <ListRow
        title="Apple Health"
        subtitle="Read data, sources and permissions"
        onPress={openData}
      />
      {log && (
        <MetricLogSheet
          key={log}
          field={log}
          initial={rawInitial ?? null}
          onClose={() => setLog(null)}
        />
      )}
      {metric && (
        <MetricHistorySheet key={metric} field={metric} onClose={() => setMetric(null)} />
      )}
    </>
  );
}
