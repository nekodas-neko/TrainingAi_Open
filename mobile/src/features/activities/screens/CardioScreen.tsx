import { useEffect, useRef, useState } from 'react';
import { openAfterClose, type AfterClose } from '../data/open-after-close';
import { pickActivity } from '../data/pick-activity';
import {
  zoneLabel,
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
import { StartActivitySheet } from '../components/StartActivitySheet';
import { startActions } from '../data/cardio-start-actions';
import {
  startButtonTitle,
  treadmillType,
  type StartStep,
  type TreadmillKind,
} from '../data/cardio-start';
import { ANY_ACTIVITY_COUNTS, floorLine, showWeekList } from '../data/cardio-week-view';
import { InProgressSheet } from '../components/InProgressSheet';
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
import { WalkingTodayCard, WalkingWeekCard } from '../components/WalkingWeekCards';
import { cardioPlanMode, showStepsQuotaCard } from '../data/cardio-plan-view';

export function CardioScreen({
  onBack,
  openActivity,
  openSettings,
  openRunning,
  openPlanChoice,
  openWalk,
  openBaselines,
}: {
  onBack: () => void;
  openActivity: () => void;
  openSettings: () => void;
  openRunning: () => void;
  openPlanChoice: () => void;
  openWalk: () => void;
  openBaselines: () => void;
}) {
  const { today } = useHealthData();
  const { theme } = useTheme();
  const week = useWorkoutResource(cardioWeekSpec(today)),
    running = useWorkoutResource(runningPlanSpec(today));
  const baselines = useWorkoutResource(baselinesSpec);
  const activity = useActivities();
  const [timePicker, setTimePicker] = useState(false),
    [minutes, setMinutes] = useState(30);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [startOpen, setStartOpen] = useState(false),
    [startStep, setStartStep] = useState<StartStep>('root');
  // Why the last start failed, shown in the chooser itself; `error` only reaches the header.
  const [pickError, setPickError] = useState<string | null>(null);
  // An activity is already open: null, the notice, or the notice already asking to discard.
  const [inProgress, setInProgress] = useState<null | 'notice' | 'discard'>(null);
  const data = week.data,
    plan = running.data;
  useMeasuredRunCompletion(plan?.heartHealth?.days);
  // #3779: no plan asks "walk or run" first (once per visit); a walking plan swaps the run cards for its week.
  const mode = running.data ? cardioPlanMode(plan?.plan) : null;
  const walking = mode === 'walking' ? plan?.walking : null;
  const askedChoice = useRef(false);
  useEffect(() => {
    if (mode === 'choice' && week.connected && !askedChoice.current) {
      askedChoice.current = true;
      openPlanChoice();
    }
  }, [mode, week.connected, openPlanChoice]);
  const day = plan?.heartHealth?.days.find((day) => day.date.replace(/\//g, '-') === today);
  const runMin = plan?.run?.durationMin;
  const target = day?.targetMin ?? (runMin != null && runMin > 0 ? Math.round(runMin) : undefined);
  const met = !!day?.met || plan?.run?.status === 'completed';
  const credited = day ? shownActivity(day.activities, day.creditedId) : null;
  const others = day ? day.activities.length - (credited ? 1 : 0) : 0;
  const unmeasured =
    !!day && day.activities.length > 0 && day.activities.every((row) => row.effortMin == null);
  const latest = latestBaselines(
    baselines.data?.fitnessTests ?? [],
    activity.tests.map((row) => row.payload),
  );
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
  // One start at a time: `busy` is state and lags a second tap in the same frame, this does not.
  const working = useRef(false);
  // A sheet's close and the navigation it leads to are never in the same commit (#4099): the
  // Modal has to finish closing before this screen is hidden behind the next one.
  const later = useRef<AfterClose | null>(null);
  // False while this screen is hidden behind another: nothing here navigates from a hidden screen.
  const shown = useRef(true);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
      later.current?.cancel();
    };
  }, []);
  function afterSheet(next: () => void, settled?: () => void) {
    later.current?.cancel();
    later.current = openAfterClose(next, undefined, undefined, settled, () => shown.current);
  }
  function openStart(step: StartStep = 'root') {
    setError(null);
    setPickError(null);
    setStartStep(step);
    setStartOpen(true);
  }
  const resumeOpen = () => {
    afterSheet(openActivity);
    setInProgress(null);
  };
  const select = (type: ActivityType) =>
    pickActivity(
      working,
      {
        store: activity.store,
        hasSession: !!activity.session,
        closeSheet: () => {
          setStartOpen(false);
        },
        afterSheet,
        openActivity,
        inProgress: () => {
          afterSheet(() => setInProgress('notice'));
          setStartOpen(false);
        },
        setBusy,
        setError: (message) => {
          setError(message);
          setPickError(message);
        },
      },
      type,
    );
  // Logging a finished treadmill session: record it, then open it, once. The lock is held until
  // the sheet has closed and the screen has navigated (#4099).
  function recordTreadmill(minutes: number, kind: TreadmillKind) {
    if (!activity.store || working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    setPickError(null);
    const release = () => {
      working.current = false;
      setBusy(false);
    };
    void activity.store
      .recordCompleted(treadmillType(kind), minutes)
      .then(() => {
        afterSheet(openActivity, release);
        setStartOpen(false);
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : 'Could not open the activity.';
        setError(message);
        setPickError(message);
        release();
      });
  }
  // What every start control does: the rule is in `startActions`, shared with its tests. One set
  // per surface, because each closes the sheet it sits in (the card has none).
  const startDeps = {
    hasSession: !!activity.session,
    select: (type: ActivityType) => void select(type),
    recordTreadmill: (minutes: number, kind: TreadmillKind) => recordTreadmill(minutes, kind),
    openWalk,
    openRunning,
    openStart,
    showInProgress: () => setInProgress('notice'),
    afterSheet: (next: () => void) => afterSheet(next),
  };
  const fromSheet = startActions(startDeps, () => setStartOpen(false));
  const fromTimePicker = startActions(startDeps, () => setTimePicker(false));
  const fromCard = startActions(startDeps);
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
        <>
          <HubCard
            title={activity.session.mode === 'done' ? 'Review activity' : 'Resume activity'}
            subtitle={activity.session.title || activity.session.type.label}
            icon="timer"
            onPress={openActivity}
          />
          <AppButton
            title="Discard activity"
            variant="secondary"
            onPress={() => setInProgress('discard')}
          />
        </>
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
          <StableContent minHeight={540} releaseWhenLoaded loading={!data && week.loading}>
            {data ? (
              <>
                {walking && (
                  <>
                    <WalkingWeekCard walking={walking} />
                    <WalkingTodayCard
                      walking={walking}
                      busy={busy}
                      onGuidedWalk={() => fromCard.kind('guided')}
                      onOther={() => fromCard.startSheet('else')}
                      onTreadmill={() => fromCard.startSheet('treadmill')}
                    />
                  </>
                )}
                <HeartProfileCard heart={data.heart} hasSource={data.quota.hasHrSource} />
                <TouchSurface
                  accessibilityRole="button"
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
                {showStepsQuotaCard(walking) && <StepsQuotaCard steps={data.steps} />}
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
                      {criterionLine(target ?? null)}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {ANY_ACTIVITY_COUNTS}
                    </AppText>
                    {floorLine(plan.heartHealth?.floorBpm) && (
                      <AppText variant="micro" tone="muted">
                        {floorLine(plan.heartHealth?.floorBpm)}
                      </AppText>
                    )}
                    <AppText>{RATIONALE}</AppText>
                    <Stack direction="row" justify="space-between">
                      <AppText variant="caption">{PROGRESS_LABEL}</AppText>
                      <AppText
                        variant="caption"
                        tone={met ? undefined : 'muted'}
                        style={met ? { color: theme.progress.trendUp } : undefined}
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
                    <AppButton
                      title={startButtonTitle(!!activity.session)}
                      variant={met ? 'secondary' : 'primary'}
                      disabled={!activity.ready && !activity.session}
                      onPress={() => fromCard.startSheet('root')}
                    />
                  </Card>
                )}
                {showWeekList(plan) && (
                  <WeekList days={plan?.heartHealth?.days ?? []} today={today} />
                )}
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
          {!data?.hasRunningPlan && mode !== 'walking' && (
            <AppButton
              title="How much time do you have?"
              variant="surface"
              disabled={!data}
              onPress={() => setTimePicker(true)}
            />
          )}
          {mode === 'running' && data?.hasRunningPlan && (
            <HubCard
              title="Your running plan"
              subtitle="Today's run and the weeks ahead"
              badge="Program"
              icon="legs"
              tone="neutral"
              onPress={openRunning}
            />
          )}
          {mode && (
            <HubCard
              title="Change plan"
              subtitle="Walking and heart health, or running"
              icon="swap"
              tone="neutral"
              onPress={openPlanChoice}
            />
          )}
          <CardioTrends />
        </>
      )}
      <StartActivitySheet
        visible={startOpen}
        initialStep={startStep}
        busy={busy}
        error={pickError}
        onClose={() => setStartOpen(false)}
        onDismiss={() => later.current?.closed()}
        onKind={fromSheet.kind}
        onTreadmillNow={fromSheet.treadmillNow}
        onTreadmillLog={fromSheet.treadmillLog}
        onType={fromSheet.type}
      />
      <Sheet
        visible={timePicker}
        title="How much time do you have?"
        onClose={() => setTimePicker(false)}
        onDismiss={() => later.current?.closed()}
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
            onPress={() => fromTimePicker.runningPlan()}
          />
          <AppButton
            style={{ flex: 1 }}
            title="Walk"
            variant="surface"
            onPress={() => fromTimePicker.kind('guided')}
          />
        </Stack>
        <AppButton
          title="Log activity"
          disabled={!activity.ready}
          onPress={() => fromTimePicker.startSheet('root')}
        />
      </Sheet>
      <InProgressSheet
        visible={inProgress !== null}
        title={activity.session?.title || activity.session?.type.label || 'The activity'}
        startConfirming={inProgress === 'discard'}
        onClose={() => setInProgress(null)}
        onDismiss={() => later.current?.closed()}
        onResume={resumeOpen}
        onDiscard={async () => {
          await activity.store?.discard();
        }}
      />
    </PageLayout>
  );
}
