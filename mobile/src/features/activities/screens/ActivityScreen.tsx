import { profileSpec } from '../../health/data/models';
import { treadmillSteps } from '../data/guidance';
import { GuidedActivityScreen } from './GuidedActivityScreen';
import { useEffect, useMemo, useState } from 'react';
import { formatPace, formatPaceValue } from '@trainingai/shared/health/vdot';
import { summariseRoute } from '@trainingai/shared/activity/route-summary';
import { View } from 'react-native';
import {
  AppButton,
  Card,
  AppText,
  ConfirmationCard,
  Grid,
  Icon,
  MetricTile,
  PageLayout,
  Sheet,
  Stack,
  StatusIndicator,
  TextField,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useActivities } from '../data/ActivityProvider';
import { elapsedMs } from '../data/ActivityStore';
import { activityIcon } from '../data/models';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { z } from 'zod';
import { useTrainingKeepAwake } from '../../platform/useTrainingKeepAwake';
import { failureNotice } from '../../../core/reporting/index.ts';
import { useRouteRecording } from '../data/useRouteRecording';
import { gpsStatusText, routeEligible } from '../data/route-recording';

function ManualActivityScreen({
  onBack,
  onSaved,
}: {
  onBack: () => void;
  onSaved: () => void;
}) {
  const activity = useActivities(),
    session = activity.session;
  const { timezone } = useHealthData();
  const profile = useWorkoutResource(profileSpec);
  const steps =
    session?.type.id === 'treadmill'
      ? treadmillSteps(
          session.distance.trim() ? Number(session.distance.replace(',', '.')) : undefined,
          profile.data?.user.heightCm,
        )
      : null;
  const { theme } = useTheme();
  const gps = useRouteRecording();
  // The done screen shows what will be saved: the same builder the save uses. Only built there;
  // while recording, the live readout comes from `useRouteRecording`.
  const done = session?.mode === 'done';
  const route = useMemo(
    () =>
      done && routeEligible(session) && session.endMs !== null
        ? summariseRoute(activity.route, elapsedMs(session, session.endMs) / 1000)
        : null,
    [done, session?.type, session?.guidance, session?.endMs, session?.pausedMs, activity.route],
  );
  const [now, setNow] = useState(Date.now),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [discard, setDiscard] = useState(false);
  useEffect(() => {
    setNow(Date.now());
    if (session?.mode !== 'active' || session.pauseStartMs !== null) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [session?.mode, session?.pauseStartMs]);
  const hr = useWorkoutResource(
    {
      path: '/api/oura/hr-window',
      query: {
        start: new Date(session?.startMs ?? 0).toISOString(),
        end: new Date(session?.endMs ?? 0).toISOString(),
      },
      ttl: 300_000,
      schema: z.object({ avgHr: z.number().nullish(), maxHr: z.number().nullish() }),
    },
    session?.mode === 'done',
  );
  async function run(operation: () => Promise<void>, after?: () => void) {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await operation();
      after?.();
    } catch (cause) {
      setError(
        cause instanceof z.ZodError
          ? 'Check the title and distance. Distance must be positive and fit the recorded duration.'
          : cause instanceof Error
            ? cause.message
            : 'Could not save this activity.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!session) {
    return (
      <PageLayout title="Activity" onBack={onBack}>
        <AppText>No activity in progress.</AppText>
      </PageLayout>
    );
  }
  const seconds = Math.floor(elapsedMs(session, now) / 1000);
  const clock = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const update = (patch: Parameters<NonNullable<typeof activity.store>['update']>[0]) => {
    void activity.store
      ?.update(patch)
      .catch((failure) => setError(failureNotice(
        'Could not save your draft. Please retry.',
        failure,
      )));
  };
  return (
    <PageLayout
      title={session.mode === 'done' ? 'Activity complete' : session.type.label}
      onBack={() =>
        session.mode === 'pre'
          ? void run(() => activity.store!.discard(), onBack)
          : setDiscard(true)
      }
      actions={<StatusIndicator label="Activity" busy={busy} error={error ?? activity.error} />}
      scroll={session.mode === 'done'}
      footer={
        session.mode === 'pre' ? undefined : (
          <Stack direction="row">
            <AppButton
              style={{ flex: 1 }}
              variant="surface"
              disabled={busy}
              title={
                session.mode === 'done'
                  ? 'Discard'
                  : session.pauseStartMs === null
                    ? 'Pause'
                    : 'Resume'
              }
              onPress={() =>
                session.mode === 'done'
                  ? setDiscard(true)
                  : void run(() => activity.store!.pause())
              }
            />
            <AppButton
              style={{ flex: 1 }}
              busy={busy}
              title={session.mode === 'done' ? 'Save' : 'Finish'}
              onPress={() =>
                void run(
                  () =>
                    session.mode === 'done'
                      ? activity.store!.save(timezone, { ...(hr.data ?? {}), steps })
                      : activity.store!.finish(),
                  session.mode === 'done' ? onSaved : undefined,
                )
              }
            />
          </Stack>
        )
      }
    >
      {session.mode === 'pre' ? (
        <Stack
          align="center"
          justify="center"
          gap="xl"
          style={{ flex: 1, paddingHorizontal: theme.spacing.xl }}
        >
          <Icon
            name={activityIcon(session.type.icon)}
            size={theme.sizes.icon * 2}
            tone="brand"
          />
          <AppText variant="eyebrow" tone="muted">
            {session.type.label}
          </AppText>
          <View style={{ width: '100%' }}>
            <TextField
              label="Title"
              value={session.title}
              maxLength={120}
              onChangeText={(title) => update({ title })}
            />
          </View>
          {session.type.isDistanceBased && (
            <AppText variant="caption" tone="muted">
              Your route, distance and pace will be tracked using GPS while the app is open.
            </AppText>
          )}
          <AppButton
            title="Start"
            busy={busy}
            style={{ width: '100%' }}
            onPress={() => void run(() => activity.store!.begin())}
          />
        </Stack>
      ) : session.mode === 'active' ? (
        <Stack style={{ flex: 1 }} justify="center" align="center" gap="xl">
          <AppText variant="eyebrow" tone="muted">
            {session.title || session.type.label}
          </AppText>
          <AppText variant="score" accessibilityLabel={`Elapsed time ${clock}`}>
            {clock}
          </AppText>
          <AppText tone="muted">
            {gps.eligible
              ? gpsStatusText[gps.status]
              : session.pauseStartMs === null
                ? 'Recording'
                : 'Paused'}
          </AppText>
          {gps.eligible && (
            <Stack gap="sm" style={{ width: '100%' }}>
              <Stack direction="row">
                <MetricTile
                  figure
                  label="km"
                  value={gps.distanceKm == null ? null : gps.distanceKm.toFixed(2)}
                />
                <MetricTile
                  figure
                  label="pace"
                  value={gps.paceSecPerKm == null ? null : formatPace(gps.paceSecPerKm)}
                />
              </Stack>
              {session.type.id === 'run' && gps.splits.length > 0 && (
                <AppText variant="micro" tone="muted" style={{ textAlign: 'center' }}>
                  {gps.splits
                    .map((split) => `km ${split.km}: ${formatPaceValue(split.paceSec)}`)
                    .join('  ')}
                </AppText>
              )}
              {session.type.id === 'run'
                ? (gps.gainM ?? 0) + (gps.lossM ?? 0) > 0 && (
                    <AppText variant="micro" tone="muted" style={{ textAlign: 'center' }}>
                      ↑ {gps.gainM}m · ↓ {gps.lossM}m
                    </AppText>
                  )
                : gps.gainM != null &&
                  gps.gainM >= 1 && (
                    <AppText variant="micro" tone="muted" style={{ textAlign: 'center' }}>
                      {gps.gainM} m up
                    </AppText>
                  )}
            </Stack>
          )}
          {session.target && (
            <Card>
              <AppText variant="heading">{session.target.label}</AppText>
              <AppText variant="caption">
                {session.target.minutes == null ? '' : `${session.target.minutes} min · `}
                {session.target.hrLow}–{session.target.hrHigh} bpm target
              </AppText>
              <AppText variant="micro" tone="muted">
                Live heart rate is not connected.
              </AppText>
            </Card>
          )}
        </Stack>
      ) : (
        <>
          <AppText variant="heading">{session.title || session.type.label}</AppText>
          <Grid>
            <MetricTile
              label="Duration"
              value={(Math.round(seconds / 6) / 10).toString()}
              unit="min"
            />
            <MetricTile
              label="Distance"
              value={route ? route.distanceKm.toFixed(2) : session.distance || null}
              unit="km"
            />
            {route?.avgPaceSecPerKm != null && (
              <MetricTile
                label="Avg pace"
                value={formatPaceValue(route.avgPaceSecPerKm)}
                unit="/km"
              />
            )}
          </Grid>
          {route && (
            <Grid>
              <MetricTile label="Elevation gain" value={String(route.elevationGainM)} unit="m" />
              <MetricTile label="Elevation loss" value={String(route.elevationLossM)} unit="m" />
            </Grid>
          )}
          {route && route.splits.length > 0 && (
            <Card>
              <AppText variant="eyebrow" tone="muted">
                Splits
              </AppText>
              {route.splits.map((split) => (
                <Stack key={split.km} direction="row" justify="space-between">
                  <AppText variant="caption">Km {split.km}</AppText>
                  <AppText variant="caption">{formatPace(split.paceSec)}</AppText>
                </Stack>
              ))}
            </Card>
          )}
          {!route && (session.type.isDistanceBased || session.type.id === 'treadmill') && (
            <TextField
              label="Distance covered (km)"
              value={session.distance}
              onChangeText={(distance) => update({ distance })}
              keyboardType="decimal-pad"
              placeholder="Optional"
            />
          )}
          <Grid>
            <MetricTile
              label="Average HR"
              value={hr.data?.avgHr == null ? null : String(hr.data.avgHr)}
              unit="bpm"
              tone="heart"
            />
            <MetricTile
              label="Max HR"
              value={hr.data?.maxHr == null ? null : String(hr.data.maxHr)}
              unit="bpm"
              tone="heart"
            />
          </Grid>
          {steps !== null && <MetricTile label="Steps (est.)" value={steps.toLocaleString()} />}
          <TextField
            label="Notes (optional)"
            value={session.notes}
            onChangeText={(notes) => update({ notes })}
            maxLength={1000}
            multiline
          />
        </>
      )}
      <Sheet visible={discard} title="Discard activity" onClose={() => setDiscard(false)}>
        <ConfirmationCard
          title={session.mode === 'active' ? 'Leave activity?' : 'Discard this activity?'}
          message="This activity has not been saved. Leaving now will discard it."
          danger
          confirmLabel="Discard"
          cancelLabel={session.mode === 'active' ? 'Keep recording' : 'Keep activity'}
          busy={busy}
          onConfirm={() => void run(() => activity.store!.discard(), onSaved)}
          onCancel={() => setDiscard(false)}
        />
      </Sheet>
    </PageLayout>
  );
}

export function ActivityScreen(props: { onBack: () => void; onSaved: () => void }) {
  const { session } = useActivities();
  useTrainingKeepAwake(session?.mode === 'active' && session.pauseStartMs === null);
  return session?.guidance ? (
    <GuidedActivityScreen {...props} />
  ) : (
    <ManualActivityScreen {...props} />
  );
}
