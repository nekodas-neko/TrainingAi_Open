import { useEffect } from 'react';
import { scoreBand } from '@trainingai/shared/health/score-band';
import { knownInputKeys, limitedInputsNote } from '@trainingai/shared/health/readiness-input-labels';
import { READINESS_WEIGHTS } from '@trainingai/shared/health/readiness-composite';
import { scoreGapText } from '@trainingai/shared/health/score-gap-copy';
import { scoreAverageChip } from '@trainingai/shared/health/score-average-chip';
import {
  AppText,
  Badge,
  Grid,
  IconButton,
  MetricTile,
  Notice,
  ScoreRing,
  StatusIndicator,
  HealthDetailLayout,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useHealthData } from '../data/HealthDataProvider';
import { readinessSpec, trendsSpec, metricValue } from '../data/models';
import { HealthMetricCard } from '../components/HealthMetricCard';
import { ContributorCard } from '../components/ContributorCard';
import { ResilienceNote } from '../components/ResilienceNote';
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
import {
  HeartFactors,
  HeartProgress,
  HeartHeroValue,
  HeartTrendCard,
} from '../components/HeartDetails';
import { TREND_EMPTY } from '@trainingai/shared/health/trend-empty-copy';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { DoseVitalsCard } from '../components/DoseVitalsCard';
import { resilienceAsOfLine, resilienceShortfallLine } from '@trainingai/shared/health/resilience-copy';

export type HealthDetail = 'sleep' | 'readiness' | 'activity' | 'heart-rate';
export function HealthDetailScreen({
  detail,
  onBack,
}: {
  detail: HealthDetail;
  onBack: () => void;
}) {
  const health = useHealthData();
  const { theme } = useTheme();
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
        : // Readiness's own breakdown is `readinessCompositeContributors` below. The payload's
          // `readinessContributors` was Oura's and is never shown as ours (#3000).
          null;
  const gapText = scoreGapText(state.data?.availability, detail);
  const currentNight = health.sleep[0];
  const trendField =
    detail === 'sleep'
      ? 'sleepScore'
      : detail === 'activity'
        ? 'activityScore'
        : 'readinessScore';
  const averageChip =
    detail === 'readiness'
      ? scoreAverageChip(
          score,
          trends.data?.trends
            .filter((day) => day.date < health.today)
            .map((day) => day.readinessScore) ?? [],
        )
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
            {state.data?.limited && detail !== 'readiness' && (
              <Badge label="Limited inputs" tone={tone} />
            )}
            {averageChip && <Badge label={averageChip.text} tone="recovery" />}
            {state.data && score !== null && (
              <AppText variant="caption" tone="muted">
                Computed by the app from your health and training data.
              </AppText>
            )}
            {score === null && gapText && (
              <AppText variant="caption" tone="muted">
                {gapText}
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
                <ResilienceNote
                  level={state.data.ownResilienceLevel}
                  band={state.data.ownResilienceBand}
                  confidence={state.data.ownResilienceConfidence}
                  asOf={resilienceAsOfLine(state.data.ownResilienceAsOf, health.today)}
                  shortfall={
                    state.data.ownResilienceLevel == null && state.data.ownResilienceUnavailable
                      ? resilienceShortfallLine(state.data.ownResilienceUnavailable)
                      : null
                  }
                />
              )}
            {detail === 'readiness' ? (
              state.data?.readinessCompositeContributors && (
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
                  note={state.data.limited ? limitedInputsNote(knownInputKeys(state.data.inputsMissing ?? [])) : null}
                  contributors={Object.fromEntries(
                    Object.entries(state.data.readinessCompositeContributors).map(
                      ([key, value]) => [key, value.score],
                    ),
                  )}
                  cases={state.data.readinessCompositeContributors}
                  provisional={Object.entries(state.data.readinessCompositeContributors)
                    .filter(([, value]) => value.provisional)
                    .map(([key]) => key)}
                />
              )
            ) : (
              <ContributorCard title={`${title} Contributors`} contributors={contributors} />
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
            {detail === 'readiness' && <DoseVitalsCard />}
            {detail === 'activity' && <ActivitySignalsCard />}
          </>
        )}
        {trends.data &&
          detail === 'heart-rate' &&
          (
            [
              {
                key: 'rhrBpm',
                title: 'Resting Heart Rate',
                color: theme.scores.heart,
                empty: TREND_EMPTY.rhrBpm,
              },
              {
                key: 'hrvMs',
                title: 'HRV (overnight)',
                color: theme.scores.sleep,
                empty: TREND_EMPTY.hrvMs,
              },
              {
                key: 'hrr1Bpm',
                title: 'HR Recovery (60s drop)',
                color: theme.progress.trendUp,
                empty: TREND_EMPTY.hrr1Bpm,
              },
            ] as const
          ).map((card) => (
            <HeartTrendCard
              key={card.key}
              title={card.title}
              color={card.color}
              emptyText={card.empty}
              days={trends.data!.trends.map((day) => ({
                date: day.date,
                value: day[card.key],
              }))}
            />
          ))}
        {trends.data &&
          detail !== 'heart-rate' &&
          ([trendField] as const).map((key) => (
            <HealthMetricCard
              key={key}
              title={`${title} Score`}
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
                  (state.data?.vo2MaxDate ?? state.data?.cloudVitalsDate)
                    ? `Oura's estimate · as of ${state.data?.vo2MaxDate ?? state.data?.cloudVitalsDate}`
                    : "Oura's estimate"
                }
              />
              <HealthMetricCard
                title="Vascular Age"
                value={state.data?.vascularAge}
                unit="years"
                caption={
                  (state.data?.vascularAgeDate ?? state.data?.cloudVitalsDate)
                    ? `Oura's estimate · as of ${state.data?.vascularAgeDate ?? state.data?.cloudVitalsDate}`
                    : "Oura's estimate"
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
