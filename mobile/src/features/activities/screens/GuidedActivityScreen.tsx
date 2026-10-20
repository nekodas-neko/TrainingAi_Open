import { useEffect, useMemo, useRef, useState } from 'react';
import { summariseRoute } from '@trainingai/shared/activity/route-summary';
import { View } from 'react-native';
import { ageFromDob, toAestDay } from '@trainingai/shared/date-utils';
import { getProtocol } from '@trainingai/shared/fitness-tests/protocols';
import {
  AppButton,
  AppText,
  Card,
  Grid,
  KeyValueGrid,
  MetricTile,
  PageLayout,
  ProgressBar,
  Sheet,
  Stack,
  StatusIndicator,
  TextField,
  TimerRing,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useActivities } from '../data/ActivityProvider';
import { elapsedMs } from '../data/ActivityStore';
import { fitnessResult, testDuration, walkPlan, walkSegments } from '../data/guidance';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { profileSpec, healthDaySpec, healthDaySchema } from '../../health/data/models';
import { baselinesSpec } from '../data/models';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutAction } from '../../workouts/data/useWorkoutAction';
import { useRouteRecording } from '../data/useRouteRecording';
import { gpsProblemText, routeEligible } from '../data/route-recording';
export function GuidedActivityScreen({
  onBack,
  onSaved,
}: {
  onBack: () => void;
  onSaved: () => void;
}) {
  const activity = useActivities(),
    session = activity.session,
    guidance = session?.guidance;
  const health = useHealthData(),
    profile = useWorkoutResource(profileSpec),
    action = useWorkoutAction(),
    { theme } = useTheme();
  const baseline = useWorkoutResource(baselinesSpec);
  const gps = useRouteRecording();
  const day = useWorkoutResource(
    healthDaySpec(
      session?.startMs == null
        ? health.today
        : toAestDay(new Date(session.startMs), health.timezone),
    ),
    session?.mode === 'done',
  );
  const parsedDay=healthDaySchema.safeParse(day.data);
  const recorded=parsedDay.success?parsedDay.data.activityLogs.find(row=>row.id===session?.id):undefined;
  const [now, setNow] = useState(Date.now),
    [exit, setExit] = useState<number | null>(null);
  const finishing = useRef(false),
    saving = useRef(false);
  const [exitSeconds, setExitSeconds] = useState(0);
  const openExit = () => {
    setExitSeconds(seconds);
    setExit(seconds);
  };
  const seconds = session ? Math.floor(elapsedMs(session, now) / 1000) : 0;
  // The walk's distance as it saves: pace over the walk's elapsed time (`walk-summary.tsx`).
  const route = useMemo(
    () =>
      session?.mode === 'done' && session.endMs !== null && routeEligible(session)
        ? summariseRoute(activity.route, elapsedMs(session, session.endMs) / 1000)
        : null,
    [session?.mode, session?.endMs, session?.type, session?.guidance, activity.route],
  );
  const walk = guidance?.kind === 'walk' ? walkPlan(guidance.config) : null;
  const protocol = guidance?.kind === 'test' ? getProtocol(guidance.protocol) : null;
  const total = walk?.totalSec ?? (protocol ? testDuration(protocol.id) : 0);
  const segment = walk?.segments.find(
    (block) => seconds >= block.startSec && seconds < block.endSec,
  );
  const phase = protocol?.phases?.find((phase, index, all) => {
    const start = all.slice(0, index).reduce((sum, item) => sum + item.durationSec, 0);
    return seconds >= start && seconds < start + phase.durationSec;
  });
  useEffect(() => {
    setNow(Date.now());
    if (session?.mode === 'done') {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [session?.mode]);
  useEffect(() => {
    if (
      session?.mode === 'pre' &&
      guidance?.kind === 'test' &&
      now >= guidance.countdownUntil &&
      !finishing.current
    ) {
      finishing.current = true;
      void action
        .run(() => activity.store!.begin())
        .finally(() => {
          finishing.current = false;
        });
    }
    if (session?.mode === 'active' && seconds >= total && total > 0 && !finishing.current) {
      finishing.current = true;
      void action
        .run(() => activity.store!.finishGuided())
        .finally(() => {
          finishing.current = false;
        });
    }
  }, [now, session?.mode, total]);
  useEffect(() => {
    if (
      session?.mode === 'done' &&
      guidance?.kind === 'walk' &&
      !guidance.saved &&
      !saving.current
    ) {
      saving.current = true;
      void action
        .run(() => activity.store!.saveWalk(health.timezone))
        .finally(() => {
          saving.current = false;
        });
    }
  }, [session?.mode, guidance?.kind]);
  if (!session || !guidance) {
    return <PageLayout title="Activity" onBack={onBack} />;
  }
  const clock = (value: number) =>
    `${Math.floor(Math.max(0, value) / 60)}:${String(Math.max(0, value) % 60).padStart(2, '0')}`;
  const user = profile.data?.user;
  const measured = {
    age: ageFromDob(
      typeof user?.dateOfBirth === 'string' ? user.dateOfBirth : null,
      new Date(),
    ),
    sex: user?.sex,
    weightKg: health.body?.today?.weightKg,
    restingHr: health.body?.today?.restingHeartRate,
  };
  let result: ReturnType<typeof fitnessResult> | null = null;
  try {
    if (session.mode === 'done' && guidance.kind === 'test') {
      result = fitnessResult(session, health.timezone, measured);
    }
  } catch {}
  const previous = [...(baseline.data?.fitnessTests ?? [])]
    .filter((row) => row.testType === protocol?.id && row.id !== session.id)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const previousValue = protocol?.captureHrr ? previous?.hrr1Bpm : previous?.vo2maxEst;
  const resultValue = protocol?.captureHrr
    ? result?.payload.hrr1Bpm
    : result?.payload.vo2maxEst;
  const delta =
    previousValue != null && resultValue != null
      ? Math.round((resultValue - previousValue) * 10) / 10
      : null;
  const update = (patch: Parameters<NonNullable<typeof activity.store>['update']>[0]) =>
    void activity.store?.update(patch).catch(() => {});
  async function finish() {
    if (await action.run(() => activity.store!.finishGuided())) {
      setExit(null);
    }
  }
  const saved = guidance.kind === 'walk' && guidance.saved;
  return (
    <PageLayout
      title={
        session.mode === 'done'
          ? protocol
            ? 'Test result'
            : 'Walk complete'
          : (protocol?.name ?? 'Interval walk')
      }
      scroll={session.mode === 'done'}
      onBack={() =>
        session.mode === 'done' && saved
          ? void action.run(async () => {
              await activity.store!.discard();
              onSaved();
            })
          : openExit()
      }
      actions={
        <StatusIndicator
          label="Guided activity"
          busy={action.busy || activity.syncing}
          error={action.error ?? activity.error}
          onRetry={() => void activity.store?.sync()}
        />
      }
      footer={
        session.mode === 'done' ? (
          <AppButton
            title={guidance.kind === 'test' ? 'Save test result' : 'Done'}
            busy={action.busy}
            disabled={guidance.kind === 'test' && !result}
            onPress={() =>
              void action.run(async () => {
                if (guidance.kind === 'test') {
                  await activity.store!.saveFitness(health.timezone, measured);
                } else {
                  await activity.store!.saveWalk(health.timezone);
                  await activity.store!.discard();
                }
                onSaved();
              })
            }
          />
        ) : (
          <AppButton
            title={protocol ? 'Finish test' : 'Exit walk'}
            variant="surface"
            onPress={() => openExit()}
          />
        )
      }
    >
      {session.mode === 'pre' && guidance.kind === 'test' ? (
        <Stack style={{ flex: 1 }} align="center" justify="center">
          <AppText variant="display">
            {Math.max(1, Math.ceil((guidance.countdownUntil - now) / 1000))}
          </AppText>
          <AppText tone="muted">Get ready</AppText>
        </Stack>
      ) : session.mode === 'active' ? (
        <Stack
          style={{ flex: 1, paddingHorizontal: theme.spacing.lg }}
          align="center"
          justify="center"
          gap="lg"
        >
          <AppText variant="eyebrow" tone="brand">
            {segment
              ? `${segment.kind === 'fast' ? 'Fast' : segment.kind === 'slow' ? 'Slow' : segment.kind === 'warmup' ? 'Warm-up' : 'Cool-down'} · ${segment.setNumber ? `set ${segment.setNumber}/${guidance.kind === 'walk' ? guidance.config.sets : 0}` : ''}`
              : (phase?.label ?? protocol?.shortName)}
          </AppText>
          <TimerRing
            value={clock(segment ? segment.endSec - seconds : total - seconds)}
            caption={segment ? 'This block' : 'Remaining'}
            progress={seconds / total}
          />
          <AppText variant="caption" tone="muted">
            {phase?.instruction ??
              (segment?.kind === 'fast'
                ? 'Walk briskly for this block.'
                : 'Walk at an easy, comfortable pace.')}
          </AppText>
          <AppText variant="caption">
            {clock(seconds)} elapsed · {clock(total)} total
          </AppText>
          {guidance.kind === 'walk' && segment && ['fast', 'slow'].includes(segment.kind) && (
            <Card>
              <AppText variant="caption">
                {segment.kind === 'fast'
                  ? `Fast target ≥ ${guidance.config.fastCadenceSpm} spm`
                  : `Slow target ≤ ${guidance.config.slowCadenceSpm} spm`}
              </AppText>
              <AppText variant="micro" tone="muted">
                Live pacing is unavailable until a sensor is connected.
              </AppText>
            </Card>
          )}
          {gps.eligible &&
            (gps.distanceKm != null && gps.distanceKm > 0 ? (
              <AppText variant="caption" tone="muted">
                {gps.distanceKm.toFixed(2)} km
                {gps.status === 'lost' ? ` · ${gpsProblemText.lost}` : ''}
              </AppText>
            ) : (
              gps.status !== 'tracking' &&
              gps.status !== 'paused' && (
                <AppText variant="micro" tone="muted">
                  {gpsProblemText[gps.status]}
                </AppText>
              )
            ))}
          {protocol?.captureDistance && (
            <AppText variant="micro" tone="muted">
              Measure the covered distance; enter it on the result screen.
            </AppText>
          )}
        </Stack>
      ) : (
        <>
          <AppText variant="heading">{protocol?.name ?? 'Interval walk'}</AppText>
          <Grid>
            <MetricTile label="Duration" value={(seconds / 60).toFixed(1)} unit="min" />
            <MetricTile
              label={
                guidance.kind === 'walk'
                  ? 'Distance'
                  : protocol?.captureHrr
                    ? '1-min HR recovery'
                    : 'Est. VO₂max'
              }
              value={
                guidance.kind === 'test'
                  ? ((protocol?.captureHrr
                      ? result?.payload.hrr1Bpm
                      : result?.payload.vo2maxEst
                    )?.toString() ?? null)
                  : route
                    ? route.distanceKm.toFixed(2)
                    : null
              }
              unit={protocol?.captureHrr ? 'bpm drop' : protocol ? 'mL/kg/min' : 'km'}
            />
          </Grid>
          {guidance.kind === 'test' && (
            <>
              {delta != null && (
                <AppText variant="caption" tone="brand">
                  {delta > 0 ? '+' : ''}
                  {delta} since your previous test
                </AppText>
              )}
              {protocol?.captureDistance && (
                <TextField
                  label="Distance covered (km)"
                  value={session.distance}
                  keyboardType="decimal-pad"
                  onChangeText={(distance) => update({ distance })}
                />
              )}
              {protocol?.captureHrr && (
                <>
                  <AppText variant="caption" tone="muted">
                    Enter measurements from your sensor. Leave missing readings blank.
                  </AppText>
                  <TextField
                    label="Resting heart rate (bpm)"
                    value={guidance.restingHr}
                    keyboardType="number-pad"
                    onChangeText={(restingHr) =>
                      update({ guidance: { ...guidance, restingHr } })
                    }
                  />
                  <TextField
                    label="Peak heart rate (bpm)"
                    value={guidance.peakHr}
                    keyboardType="number-pad"
                    onChangeText={(peakHr) => update({ guidance: { ...guidance, peakHr } })}
                  />
                  <TextField
                    label="Heart rate after 1 minute recovery (bpm)"
                    value={guidance.recoveryHr}
                    keyboardType="number-pad"
                    onChangeText={(recoveryHr) =>
                      update({ guidance: { ...guidance, recoveryHr } })
                    }
                  />
                </>
              )}
              {result?.early && (
                <AppText variant="caption" tone="muted">
                  This test ended early. Its effort can be saved; no fitness score is
                  calculated.
                </AppText>
              )}
              {protocol?.captureDistance && !result?.scoreable && !result?.early && (
                <AppText variant="caption" tone="muted">
                  Add a valid measured distance to calculate a score. Missing distance stays
                  unscored.
                </AppText>
              )}
              <TextField
                label="Notes (optional)"
                value={session.notes}
                maxLength={1000}
                onChangeText={(notes) => update({ notes })}
              />
            </>
          )}
          {guidance.kind === 'walk' && (
            <>
              <Grid>
                <MetricTile
                  label="Average HR"
                  value={recorded?.avgHr?.toString() ?? null}
                  unit="bpm"
                />
                <MetricTile
                  label="Calories (est.)"
                  value={recorded?.caloriesBurned?.toString() ?? null}
                  unit="kcal"
                />
              </Grid>
              <Card>
                <AppText variant="eyebrow" tone="muted">
                  Per interval
                </AppText>
                {walkSegments(guidance.config, seconds).map((block) => (
                  <Stack key={block.index} direction="row" justify="space-between">
                    <AppText variant="caption">
                      {block.setNumber ? `Set ${block.setNumber} · ` : ''}
                      {block.kind}
                    </AppText>
                    <AppText variant="caption">
                      {clock(Math.round(block.endSec - block.startSec))}
                    </AppText>
                  </Stack>
                ))}
              </Card>
              <AppText variant="micro" tone="muted">
                {saved ? 'Saved to your activity history.' : 'Saving on this phone…'}
              </AppText>
            </>
          )}
        </>
      )}
      <Sheet
        visible={exit !== null}
        title={
          protocol
            ? 'Finish test?'
            : exitSeconds < 60
              ? 'Discard this walk?'
              : 'Exit this walk?'
        }
        onClose={() => setExit(null)}
      >
        <AppText variant="caption" tone="muted">
          {protocol
            ? 'Ending early preserves the effort but may leave the fitness score unavailable.'
            : `You have walked ${clock(exitSeconds)}. ${exitSeconds < 60 ? 'This is too short to record.' : 'Save it to your history, or discard it.'}`}
        </AppText>
        {(protocol || exitSeconds >= 60) && (
          <AppButton
            title={protocol ? 'Finish test' : 'Save walk'}
            busy={action.busy}
            onPress={() => void finish()}
          />
        )}
        <AppButton
          title="Discard"
          variant="danger"
          disabled={action.busy}
          onPress={() =>
            void action.run(async () => {
              await activity.store!.discard();
              onSaved();
            })
          }
        />
        <AppButton
          title={protocol ? 'Keep going' : 'Keep walking'}
          variant="surface"
          onPress={() => setExit(null)}
        />
      </Sheet>
    </PageLayout>
  );
}
