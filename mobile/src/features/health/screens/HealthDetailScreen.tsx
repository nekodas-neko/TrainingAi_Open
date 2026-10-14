import { useEffect } from 'react';
import { scoreBand } from '@trainingai/shared/health/score-band';
import { READINESS_WEIGHTS } from '@trainingai/shared/health/readiness-composite';
import {
  AppText,
  Badge,
  Card,
  Grid,
  IconButton,
  MetricTile,
  Notice,
  ScoreRing,
  StatusIndicator,
  HealthDetailLayout,
  KeyValueGrid,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useHealthData } from '../data/HealthDataProvider';
import { readinessSpec, trendsSpec, metricValue } from '../data/models';
import { HealthMetricCard } from '../components/HealthMetricCard';
import { ContributorCard } from '../components/ContributorCard';
import { ManualNightCard } from '../components/ManualNightCard';
import { SleepNight } from '../components/SleepNight';
import { HealthSyncNotice } from '../components/HealthSyncNotice';
import { HrDayCard } from '../components/HrDayCard';
import { HealthInsight } from '../components/HealthInsight';
import { ObservedHeartCard } from '../components/RecordedHealthCards';
import { ActivitySignalsCard } from '../components/ActivitySignalsCard';
import { RememberedBedtimeCard } from '../components/RememberedBedtimeCard';
import { SleepTrendsCard } from '../components/SleepTrendsCard';
import { HealthViewReady } from '../components/HealthViewReady';
import { HeartFactors, HeartProgress, HeartHeroValue } from '../components/HeartDetails';
import { DoseVitalsCard } from '../components/DoseVitalsCard';
import { resilienceAsOfLine, resilienceShortfallLine } from '../data/resilience-copy';

export type HealthDetail = 'sleep' | 'readiness' | 'activity' | 'heart-rate';
export function HealthDetailScreen({
  detail,
  onBack,
}: {
  detail: HealthDetail;
  onBack: () => void;
}) {
  const health = useHealthData();
  const state = useWorkoutResource(readinessSpec(health.today));
  const trends = useWorkoutResource(trendsSpec(health.today));
  useEffect(() => {
    void health.store?.refresh();
  }, [health.store, health.today]);
  const title = {
    sleep: 'Sleep',
    readiness: 'Readiness',
    activity: 'Activity',
    'heart-rate': 'Heart Rate',
  }[detail];
  const field =
    detail === 'sleep'
      ? 'sleepScore'
      : detail === 'activity'
        ? 'activityScore'
        : 'readinessDisplayScore';
  const score = state.data?.[field] ?? null;
  const tone =
    detail === 'sleep'
      ? 'sleep'
      : detail === 'heart-rate'
        ? 'heart'
        : detail === 'activity'
          ? 'activity'
          : 'recovery';
  const contributors =
    detail === 'sleep'
      ? state.data?.sleepContributors
      : detail === 'activity'
        ? state.data?.activityContributors
        : state.data?.readinessContributors;
  const currentNight = health.sleep[0];
  const trendField =
    detail === 'sleep'
      ? 'sleepScore'
      : detail === 'activity'
        ? 'activityScore'
        : 'readinessScore';
  const priorReadiness =
    trends.data?.trends
      .filter((day) => day.date < health.today)
      .flatMap((day) => (day.readinessScore == null ? [] : [day.readinessScore])) ?? [];
  const averageReadiness = priorReadiness.length
    ? Math.round(priorReadiness.reduce((sum, value) => sum + value, 0) / priorReadiness.length)
    : null;
  return (
    <HealthDetailLayout
      title={title}
      kind={detail}
      onBack={onBack}
      refreshing={state.refreshing || health.refreshing}
      onRefresh={() => {
        state.refresh();
        trends.refresh();
        health.refresh();
      }}
      hero={
        detail === 'heart-rate' ? (
          <HeartHeroValue bpm={state.data?.hrCurrent ?? null} />
        ) : (
          <ScoreRing
            value={score}
            label={`${title} Score`}
            caption={score === null ? undefined : scoreBand(score).label}
            tone={tone}
            signal={
              score === null
                ? undefined
                : scoreBand(score).label === 'High'
                  ? 'main'
                  : scoreBand(score).label === 'Moderate'
                    ? 'secondary'
                    : 'injured'
            }
          />
        )
      }
      actions={
        <>
          <StatusIndicator
            label={`${title} records`}
            busy={state.loading || trends.loading || !health.ready}
            error={
              state.error ??
              trends.error ??
              health.bodyError ??
              health.sleepError ??
              health.error
            }
            onRetry={() => {
              state.refresh();
              trends.refresh();
              health.refresh();
            }}
          />
          <HealthSyncNotice inline />
          <IconButton
            icon="refresh"
            label={`Refresh ${title}`}
            busy={state.refreshing || health.refreshing}
            onPress={() => {
              state.refresh();
              trends.refresh();
              health.refresh();
            }}
          />
        </>
      }
    >
      <HealthViewReady view={detail}>
        {detail === 'heart-rate' ? (
          <>
            <AppText variant="eyebrow" tone="muted">
              Today so far
            </AppText>
            <Grid columns={2}>
              {(['hrCurrent', 'hrMin', 'hrAvg', 'hrMax'] as const).map((key, index) => (
                <MetricTile
                  key={key}
                  label={['Current', 'Min', 'Average', 'Max'][index]}
                  value={metricValue(state.data?.[key], 'bpm')}
                  tone="heart"
                />
              ))}
            </Grid>
            <ObservedHeartCard />
            <HeartFactors data={state.data} />
            <HrDayCard />
            <HeartProgress trends={trends.data?.trends} />
          </>
        ) : (
          <>
            {detail === 'readiness' && (
              <AppText variant="caption" tone="muted">
                How your day is likely to go, set this morning from last night’s sleep and
                yesterday. It does not move as you use energy — that is Body Battery.
              </AppText>
            )}
            {state.data?.limited && <Badge label="Limited inputs" tone={tone} />}
            {detail === 'readiness' && score != null && averageReadiness != null && (
              <Badge
                label={`${score - averageReadiness >= 0 ? '+' : ''}${Math.round(score - averageReadiness)} vs your ${priorReadiness.length}-day average (${averageReadiness})`}
                tone="recovery"
              />
            )}
            {state.data?.ouraScore === null && score !== null && (
              <AppText variant="caption" tone="muted">
                Computed by the app from your health and training data.
              </AppText>
            )}
            {score === null && state.data && (
              <AppText variant="caption" tone="muted">
                {state.data.availability?.find((entry) => entry.metric === detail)?.gap ===
                'awaiting_baseline'
                  ? 'Not enough history to score this yet'
                  : `No ${title.toLowerCase()} score available for today.`}
              </AppText>
            )}
            {detail === 'sleep' && (
              <>
                <ManualNightCard />
              </>
            )}
            {detail === 'readiness' && state.data?.illnessAdvisory && (
              <Notice title="Readiness advisory" message={state.data.illnessAdvisory} />
            )}
            {detail === 'readiness' &&
              state.data &&
              (state.data.ownResilienceLevel != null ||
                state.data.ownResilienceUnavailable) && (
                <HealthMetricCard
                  title="Resilience"
                  value={state.data.ownResilienceLevel}
                  decimals={1}
                  caption={
                    state.data.ownResilienceLevel != null
                      ? `${state.data.ownResilienceBand ?? ''} ${resilienceAsOfLine(state.data.ownResilienceAsOf, health.today) ?? ''}`
                      : 'Not published yet'
                  }
                >
                  {state.data.ownResilienceLevel == null &&
                    state.data.ownResilienceUnavailable && (
                      <AppText variant="caption" tone="muted">
                        {resilienceShortfallLine(state.data.ownResilienceUnavailable)}
                      </AppText>
                    )}
                  {state.data.ownResilienceLevel != null &&
                    state.data.ownResilienceConfidence != null &&
                    state.data.ownResilienceConfidence < 1 && (
                      <AppText variant="caption" tone="muted">
                        Still building — based on{' '}
                        {Math.round(state.data.ownResilienceConfidence * 14)} of the last 14
                        days.
                      </AppText>
                    )}
                </HealthMetricCard>
              )}
            {detail === 'readiness' &&
            state.data?.ouraScore === null &&
            state.data.readinessCompositeContributors ? (
              <ContributorCard
                title="What goes into this score"
                weights={READINESS_WEIGHTS}
                temperature={state.data.temperatureDeviation}
                extras={{
                  hrvBalance: `Recent 7-day HRV ${metricValue(state.data.recentHrv, 'ms')} · baseline ${metricValue(state.data.baselineHrv, 'ms')}`,
                  ...(state.data.temperatureDeviation != null
                    ? {
                        temperature: `${state.data.temperatureDeviation > 0 ? '+' : ''}${state.data.temperatureDeviation.toFixed(1)}°C vs your baseline`,
                      }
                    : {}),
                }}
                contributors={Object.fromEntries(
                  Object.entries(state.data.readinessCompositeContributors).map(
                    ([key, value]) => [key, value.score],
                  ),
                )}
                provisional={Object.entries(state.data.readinessCompositeContributors)
                  .filter(([, value]) => value.provisional)
                  .map(([key]) => key)}
              />
            ) : (
              <>
                {detail === 'readiness' && state.data?.ouraScore != null && score != null && (
                  <Card>
                    <AppText variant="eyebrow" tone="muted">
                      How this score is built
                    </AppText>
                    <KeyValueGrid
                      rows={[
                        {
                          label: 'Baseline',
                          value: metricValue(state.data.ouraScore),
                        },
                        {
                          label:
                            state.data.source === 'oura+acwr'
                              ? 'Training load (ACWR)'
                              : 'Adjustment',
                          value: metricValue(score - state.data.ouraScore),
                        },
                        {
                          label: 'Final readiness',
                          value: `${scoreBand(score).label} · ${score}`,
                        },
                      ]}
                    />
                  </Card>
                )}
                <ContributorCard title={`${title} Contributors`} contributors={contributors} />
              </>
            )}
            {detail === 'sleep' && (
              <>
                {state.data?.sleepScoreCoverage &&
                  state.data.sleepScoreCoverage.level !== 'full' && (
                    <Notice
                      title="Partial sleep data"
                      message={`The score uses the recorded inputs. Missing: ${state.data.sleepScoreCoverage.missing.join(', ')}.`}
                    />
                  )}
                {currentNight?.provisional && (
                  <Notice
                    title="Still updating"
                    message="The night is still arriving. Its score and stage totals can change as more recordings arrive."
                  />
                )}
                {currentNight && !currentNight.manualEntry && (
                  <SleepNight stagesOnly night={currentNight} />
                )}
                {currentNight && !currentNight.manualEntry && (
                  <RememberedBedtimeCard key={currentNight.date} night={currentNight} />
                )}
                <SleepTrendsCard />
                {trends.data && (
                  <HealthMetricCard
                    title="Skin Temperature"
                    caption="Deviation from personal baseline · °C"
                    tone="activity"
                    points={trends.data.trends.map((day) => ({
                      label: day.date,
                      value: day.temperatureDeviation,
                    }))}
                  />
                )}
              </>
            )}
            {detail === 'readiness' && state.data?.daySummary && (
              <Card>
                <AppText>{state.data.daySummary}</AppText>
              </Card>
            )}
            {detail === 'readiness' && <DoseVitalsCard />}
            {detail === 'activity' && <ActivitySignalsCard />}
          </>
        )}
        {trends.data &&
          (detail === 'heart-rate'
            ? (['rhrBpm', 'hrvMs', 'hrr1Bpm'] as const)
            : ([trendField] as const)
          ).map((key) => (
            <HealthMetricCard
              key={key}
              title={
                key === 'rhrBpm'
                  ? 'Resting Heart Rate'
                  : key === 'hrvMs'
                    ? 'HRV (overnight)'
                    : key === 'hrr1Bpm'
                      ? 'HR Recovery (60s drop)'
                      : `${title} Score`
              }
              tone={tone}
              caption="Last 14 days · gaps mean not recorded"
              points={trends.data!.trends.map((day) => ({
                label: day.date,
                value: day[key],
              }))}
            />
          ))}
        {detail === 'heart-rate' &&
          (state.data?.vo2Max != null || state.data?.vascularAge != null) && (
            <Grid columns={2}>
              <HealthMetricCard
                title="VO₂ Max"
                value={state.data?.vo2Max}
                unit="ml/kg/min"
                caption={
                  state.data?.cloudVitalsDate
                    ? `As of ${state.data.cloudVitalsDate}`
                    : undefined
                }
              />
              <HealthMetricCard
                title="Vascular Age"
                value={state.data?.vascularAge}
                unit="years"
                caption={
                  state.data?.cloudVitalsDate
                    ? `As of ${state.data.cloudVitalsDate}`
                    : undefined
                }
              />
            </Grid>
          )}
        <HealthInsight
          section={detail}
          hasData={
            detail === 'heart-rate'
              ? !!trends.data?.trends.some((day) => day.rhrBpm != null || day.hrvMs != null)
              : score !== null
          }
        />
      </HealthViewReady>
    </HealthDetailLayout>
  );
}
