import { useState } from 'react';
import {
  zoneLabel,
  ANY_ACTIVITY,
  CARD_TITLE,
  PROGRESS_LABEL,
  RATIONALE,
  criterionLine,
  progressFigure,
  shownActivity,
} from '@trainingai/shared/running/heart-health-copy';
import { recommendSession } from '@trainingai/shared/health/session-picker';
import {
  AppButton,
  AppText,
  Card,
  ChoiceTiles,
  HubCard,
  Icon,
  Badge,
  PageLayout,
  ProgressBar,
  Sheet,
  StableContent,
  Stack,
  StateCard,
  StatusIndicator,
  TouchSurface,
} from '../../../shared/ui';
import { useActivities, useMeasuredRunCompletion } from '../data/ActivityProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import {
  baselinesSpec,
  cardioWeekSpec,
  runningPlanSpec,
  type ActivityType,
} from '../data/models';
import { ActivityPicker } from '../components/ActivityPicker';
import {
  BaselinesRow,
  HeartProfileCard,
  LazyDayCreditCard,
  StepsQuotaCard,
  WeekList,
  ZoneQuotaCard,
} from '../components/CardioCards';
import { latestBaselines } from '../data/cardio-view';
import { CardioTrends } from '../components/CardioTrends';

export function CardioScreen({
  onBack,
  openActivity,
  openSettings,
  openRunning,
  openWalk,
  openBaselines,
}: {
  onBack: () => void;
  openActivity: () => void;
  openSettings: () => void;
  openRunning: () => void;
  openWalk: () => void;
  openBaselines: () => void;
}) {
  const { today } = useHealthData();
  const { theme } = useTheme();
  const week = useWorkoutResource(cardioWeekSpec(today)),
    running = useWorkoutResource(runningPlanSpec(today));
  const baselines = useWorkoutResource(baselinesSpec);
  const activity = useActivities();
  const [picker, setPicker] = useState(false),
    [timePicker, setTimePicker] = useState(false),
    [minutes, setMinutes] = useState(30);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [choose, setChoose] = useState(false);
  const data = week.data,
    plan = running.data;
  useMeasuredRunCompletion(plan?.heartHealth?.days);
  const day = plan?.heartHealth?.days.find((day) => day.date.replace(/\//g, '-') === today);
  const target = day?.targetMin ?? plan?.run?.durationMin;
  const met = !!day?.met || plan?.run?.status === 'completed';
  const credited = day ? shownActivity(day.activities, day.creditedId) : null;
  const others = day ? day.activities.length - (credited ? 1 : 0) : 0;
  const unmeasured =
    !!day && day.activities.length > 0 && day.activities.every((row) => row.effortMin == null);
  const latest = latestBaselines([
    ...(baselines.data?.fitnessTests ?? []),
    ...activity.tests.map((row) => row.payload),
  ]);
  const recommendation = data
    ? recommendSession({
        minutesAvailable: minutes,
        quota: {
          ...data.quota,
          zones: data.quota.zones.map((row) => ({
            ...row,
            zoneId: row.zoneId as 1 | 2 | 3 | 4 | 5,
          })),
        },
        runningPlan: {
          hasPlan: !!plan?.plan,
          runPending: plan?.run?.status === 'pending',
          prescriptionDurationMin: plan?.prescription?.durationMin ?? null,
          prescriptionType: plan?.prescription?.type ?? null,
          gateAction: plan?.gateAction ?? null,
          gateReasons: plan?.gateReasons ?? [],
        },
      })
    : null;
  async function select(type: ActivityType) {
    if (!activity.store || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await activity.store.start(type);
      setPicker(false);
      openActivity();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start activity.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageLayout
      title="Cardio Hub"
      scroll
      onBack={onBack}
      actions={
        <StatusIndicator
          label="Cardio"
          busy={week.refreshing || activity.syncing || busy}
          error={error ?? activity.error ?? week.error}
          message={
            activity.pending ? 'Activities saved on this phone, waiting to upload.' : null
          }
          onRetry={() => {
            week.refresh();
            void activity.store?.sync();
          }}
        />
      }
    >
      {activity.session && (
        <HubCard
          title={activity.session.mode === 'done' ? 'Review activity' : 'Resume activity'}
          subtitle={activity.session.title || activity.session.type.label}
          icon="timer"
          onPress={openActivity}
        />
      )}
      {!week.connected ? (
        <StateCard
          title="Connect your account"
          message="Sign in to load your cardio week and log activities."
          action="Account & settings"
          onAction={openSettings}
        />
      ) : (
        <>
          <StableContent minHeight={540} loading={!data && week.loading}>
            {data ? (
              <>
                <HeartProfileCard heart={data.heart} hasSource={data.quota.hasHrSource} />
                <TouchSurface
                  accessibilityRole="button"
                  accessibilityLabel="Cardio Baselines, Fitness Baselines"
                  onPress={openBaselines}
                >
                  <Card tone="recovery">
                    <Stack direction="row" align="center" justify="space-between">
                      <Stack direction="row" align="center" gap="xs">
                        <Icon
                          name="activity"
                          size={theme.sizes.iconSmall}
                          color={theme.tones.recovery.foreground}
                        />
                        <AppText
                          variant="eyebrow"
                          style={{ color: theme.tones.recovery.foreground }}
                        >
                          Cardio Baselines
                        </AppText>
                      </Stack>
                      <Icon name="forward" tone="muted" size={theme.sizes.iconSmall} />
                    </Stack>
                    <StableContent
                      minHeight={32}
                      loading={baselines.loading && !baselines.data}
                    >
                      {!latest.length && (
                        <AppText variant="caption" tone="muted">
                          Take a fitness test to set your baseline
                        </AppText>
                      )}
                      {latest.length > 0 && <BaselinesRow tests={latest} />}
                      {baselines.error && (
                        <AppText variant="micro" tone="muted">
                          Saved baselines could not be refreshed.
                        </AppText>
                      )}
                    </StableContent>
                  </Card>
                </TouchSurface>
                <ZoneQuotaCard data={data} />
                {!data.trainedToday && (
                  <LazyDayCreditCard
                    zone1Min={
                      data.dayQuota.zones.find((row) => row.zoneId === 1)?.doneMin ?? 0
                    }
                  />
                )}
                <StepsQuotaCard steps={data.steps} />
                {plan?.run && (
                  <Card>
                    <Stack direction="row" align="center">
                      <Icon name="cardio" tone="brand" />
                      <AppText variant="heading" style={{ flex: 1 }}>
                        {CARD_TITLE}
                      </AppText>
                      {zoneLabel(plan.run.targetZoneIds ?? []) && (
                        <Badge
                          tone="recovery"
                          label={zoneLabel(plan.run.targetZoneIds ?? [])!}
                        />
                      )}
                    </Stack>
                    <AppText variant="caption" tone="muted">
                      {criterionLine(target ?? null)} · {ANY_ACTIVITY}
                    </AppText>
                    <AppText>{RATIONALE}</AppText>
                    <Stack direction="row" justify="space-between">
                      <AppText variant="caption">{PROGRESS_LABEL}</AppText>
                      <AppText
                        variant="caption"
                        tone={met ? undefined : 'muted'}
                        style={met ? { color: theme.anatomy.main } : undefined}
                      >
                        {progressFigure(day?.countedMin ?? 0, target ?? null)}
                        {met ? ' · Counted ✓' : ''}
                      </AppText>
                    </Stack>
                    <ProgressBar
                      value={met ? 1 : target ? (day?.countedMin ?? 0) / target : 0}
                      complete={met}
                    />
                    {credited && (
                      <AppText variant="caption" tone="muted">
                        from <AppText variant="caption">{credited.title}</AppText>
                        {credited.durationMin
                          ? ` · ${Math.round(credited.durationMin)} min`
                          : ''}
                        {others > 0 ? ` and ${others} more` : ''}
                      </AppText>
                    )}
                    {unmeasured && (
                      <AppText variant="micro" tone="muted">
                        No heart rate recorded during it, so it has no counted minutes yet.
                      </AppText>
                    )}
                    {!day?.met && plan.run.status !== 'completed' && (
                      <AppButton
                        title={choose ? 'Back' : 'Start an activity'}
                        variant="secondary"
                        onPress={() => setChoose(!choose)}
                      />
                    )}
                    {choose && (
                      <>
                        <HubCard
                          title="Run"
                          subtitle="Start a run"
                          onPress={() =>
                            activity.session
                              ? openActivity()
                              : void select({
                                  id: 'run',
                                  label: 'Run',
                                  icon: 'PersonSimpleRun',
                                  isDistanceBased: true,
                                })
                          }
                          icon="legs"
                        />
                        <HubCard
                          title="Guided walk"
                          subtitle="Fast and easy intervals"
                          onPress={openWalk}
                          icon="legs"
                        />
                        <Card>
                          <AppText variant="label">Treadmill walk</AppText>
                          <Stack direction="row">
                            {[20, 30, 45].map((minutes) => (
                              <AppButton
                                key={minutes}
                                title={`${minutes} min`}
                                variant="surface"
                                disabled={busy || !!activity.session}
                                style={{ flex: 1 }}
                                onPress={() => {
                                  setBusy(true);
                                  void activity
                                    .store!.recordCompleted(
                                      {
                                        id: 'treadmill',
                                        label: 'Treadmill walk',
                                        icon: 'PersonSimpleWalk',
                                        isDistanceBased: false,
                                      },
                                      minutes,
                                    )
                                    .then(openActivity)
                                    .catch((cause) =>
                                      setError(
                                        cause instanceof Error
                                          ? cause.message
                                          : 'Could not open the activity.',
                                      ),
                                    )
                                    .finally(() => setBusy(false));
                                }}
                              />
                            ))}
                          </Stack>
                        </Card>
                        <HubCard
                          title="Other activity"
                          subtitle="Treadmill, cycle, anything logged"
                          icon="activity"
                          onPress={() => setPicker(true)}
                        />
                      </>
                    )}
                  </Card>
                )}
                <WeekList days={plan?.heartHealth?.days ?? []} today={today} />
              </>
            ) : (
              <StateCard
                title="Your cardio week is unavailable"
                message="Check your connection and retry."
                action="Retry"
                onAction={week.refresh}
              />
            )}
          </StableContent>
          <AppText variant="eyebrow" tone="muted">
            What do you want to do?
          </AppText>
          {!data?.hasRunningPlan && (
            <AppButton
              title="How much time do you have?"
              variant="surface"
              disabled={!data}
              onPress={() => setTimePicker(true)}
            />
          )}
          <HubCard
            title="Run"
            subtitle={data?.hasRunningPlan ? 'Your running plan' : 'Set up a running plan'}
            badge={data?.hasRunningPlan ? 'Program' : undefined}
            icon="legs"
            tone="recovery"
            onPress={openRunning}
          />
          <HubCard
            title="Guided walk"
            subtitle="Interval walk with fast and easy blocks"
            icon="legs"
            tone="brand"
            onPress={openWalk}
          />
          <HubCard
            title="Other activity"
            subtitle="Treadmill, cycle, anything logged"
            icon="activity"
            tone="neutral"
            onPress={
              activity.ready && !activity.session
                ? () => setPicker(true)
                : activity.session
                  ? openActivity
                  : undefined
            }
          />
          <CardioTrends />
        </>
      )}
      <ActivityPicker
        visible={picker}
        busy={busy}
        onClose={() => setPicker(false)}
        onSelect={(type) => void select(type)}
      />
      <Sheet
        visible={timePicker}
        title="How much time do you have?"
        onClose={() => setTimePicker(false)}
      >
        <ChoiceTiles
          label="Time available"
          value={minutes}
          options={[15, 30, 45, 60].map((value) => ({ value, label: `${value} min` }))}
          onChange={setMinutes}
        />
        {recommendation && (
          <Card>
            <AppText variant="heading">
              {recommendation.modality === 'run'
                ? 'Run'
                : recommendation.modality === 'walk'
                  ? 'Guided walk'
                  : 'Other activity'}
            </AppText>
            <AppText tone="muted">{recommendation.reason}</AppText>
            {recommendation.gate && (
              <AppText tone="muted">{recommendation.gate.reasons.join(' ')}</AppText>
            )}
          </Card>
        )}
        <Stack direction="row">
          <AppButton
            style={{ flex: 1 }}
            title="Run"
            variant="surface"
            onPress={() => {
              setTimePicker(false);
              openRunning();
            }}
          />
          <AppButton
            style={{ flex: 1 }}
            title="Walk"
            variant="surface"
            onPress={() => {
              setTimePicker(false);
              openWalk();
            }}
          />
        </Stack>
        <AppButton
          title="Log activity"
          disabled={!activity.ready || !!activity.session}
          onPress={() => {
            setTimePicker(false);
            setPicker(true);
          }}
        />
      </Sheet>
    </PageLayout>
  );
}
