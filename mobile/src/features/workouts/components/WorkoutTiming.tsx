import { AppText, Card, Disclosure, ProgressBar, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { formatDuration } from '../../../shared/hooks/useClock';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { timingSpec } from '../data/models';
import { workoutTiming } from '../logging/timing';
import { workoutResult } from '../logging/summary';
import type { WorkoutRecord } from '../logging/workout';

type TimingKind = 'Setup' | 'Work' | 'Rest';

function TimeBar({
  actual,
  planned,
  kind,
}: {
  actual: number;
  planned: number;
  kind: TimingKind;
}) {
  const { theme } = useTheme();
  const scale = Math.max(actual, planned, 1) * 1.12;
  const color =
    actual > planned * 1.05
      ? kind === 'Rest'
        ? theme.anatomy.secondary
        : theme.scores.readiness
      : theme.colors.brand;
  return <ProgressBar value={actual / scale} target={planned / scale} color={color} />;
}

function TimingRow({
  kind,
  actual,
  planned,
}: {
  kind: TimingKind;
  actual: number | null;
  planned: number | null;
}) {
  return (
    <Stack gap="xs">
      <Stack direction="row" justify="space-between" align="baseline" gap="sm">
        <AppText variant="eyebrow" tone="muted">
          {kind.toUpperCase()}
        </AppText>
        <AppText variant="caption" style={{ flexShrink: 1, textAlign: 'right' }}>
          <AppText variant="caption" tone="brand">
            {actual === null ? 'Unavailable' : formatDuration(actual)}
          </AppText>{' '}
          actual · {planned === null ? 'unavailable' : formatDuration(planned)} planned
        </AppText>
      </Stack>
      {actual !== null && planned !== null && (
        <TimeBar actual={actual} planned={planned} kind={kind} />
      )}
    </Stack>
  );
}

function minutes(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  if (total >= 600) return `${Math.round(total / 60)} min`;
  const remainder = total % 60;
  return remainder === 0
    ? `${Math.floor(total / 60)} min`
    : `${Math.floor(total / 60)}m ${remainder}s`;
}

export function WorkoutTiming({ workout }: { workout: WorkoutRecord }) {
  const { theme } = useTheme();
  const remote = useWorkoutResource(timingSpec(workout.id), workout.pending.length === 0);
  const result = workoutResult(workout);
  const exercises = workoutTiming(workout).map((x, index) => {
    const server = remote.data?.exercises[index];
    const matching = server?.name === x.name ? server : null;
    return {
      ...x,
      setupActualSec: x.setupActualSec ?? matching?.setupActualSec ?? null,
      workActualSec: x.workActualSec ?? matching?.workActualSec ?? null,
      restActualSec: x.restActualSec ?? matching?.restActualSec ?? null,
    };
  });
  const restRows = exercises.filter(
    (x) => x.restExpectedSec === null || x.restExpectedSec > 0,
  );
  const restActual =
    restRows.length && restRows.every((x) => x.restActualSec !== null)
      ? restRows.reduce((total, x) => total + x.restActualSec!, 0)
      : null;
  const restPlanned =
    restRows.length && restRows.every((x) => x.restExpectedSec !== null)
      ? restRows.reduce((total, x) => total + x.restExpectedSec!, 0)
      : null;
  const restDifference =
    restActual !== null && restPlanned !== null ? restActual - restPlanned : null;
  return (
    <Card style={{ width: '100%', maxWidth: theme.sizes.summaryWidth }}>
      <AppText variant="eyebrow" tone="muted">
        Time summary
      </AppText>
      {restActual !== null && restPlanned !== null && restPlanned > 0 && (
        <Card>
          <AppText variant="caption" tone="muted">
            Rest this session
          </AppText>
          <Stack direction="row" justify="space-between" align="baseline" gap="sm">
            <AppText variant="label" tone="brand">
              {minutes(restActual)}{' '}
              <AppText variant="micro" tone="muted">
                ACTUAL
              </AppText>
            </AppText>
            <AppText variant="label" tone="muted">
              {minutes(restPlanned)}{' '}
              <AppText variant="micro" tone="muted">
                PLANNED
              </AppText>
            </AppText>
          </Stack>
          <TimeBar actual={restActual} planned={restPlanned} kind="Rest" />
          <AppText variant="caption" tone="muted">
            {Math.abs(restDifference!) <= 60
              ? 'Your rest was right on target.'
              : `You rested ${minutes(Math.abs(restDifference!))} ${restDifference! > 0 ? 'longer' : 'less'} than planned.`}
          </AppText>
        </Card>
      )}
      {exercises.map((x) => (
        <Stack key={x.id} gap="sm">
          <AppText variant="label">{x.name}</AppText>
          <TimingRow
            kind="Setup"
            actual={x.setupActualSec}
            planned={x.setupExpectedSec}
          />
          <TimingRow kind="Work" actual={x.workActualSec} planned={x.workExpectedSec} />
          {(x.restExpectedSec === null || x.restExpectedSec > 0) && (
            <TimingRow kind="Rest" actual={x.restActualSec} planned={x.restExpectedSec} />
          )}
        </Stack>
      ))}
      <AppText variant="caption" tone="muted">
        Planned rest follows your programme. Setup and work use equipment and set-pace
        estimates.
      </AppText>
      <Disclosure title="Set timing details">
        <AppText variant="caption" tone="muted">
          Actual warm-up ·{' '}
          {result.warmupSeconds === null
            ? 'unavailable'
            : formatDuration(result.warmupSeconds)}
        </AppText>
        {exercises.map((x) => (
          <Stack key={x.id} gap="xs">
            <AppText variant="label">{x.name}</AppText>
            {x.sets.map((set, index) => (
              <AppText key={set.id} variant="caption" tone="muted">
                Set {index + 1} · work{' '}
                {set.startedAt === null
                  ? 'unavailable'
                  : formatDuration((set.completedAt! - set.startedAt) / 1000)}{' '}
                · rest{' '}
                {set.restAfterSec === null
                  ? 'unavailable'
                  : formatDuration(set.restAfterSec)}
              </AppText>
            ))}
          </Stack>
        ))}
      </Disclosure>
    </Card>
  );
}
