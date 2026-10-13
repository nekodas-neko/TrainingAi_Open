import { useTrainingSync } from '../workouts/data/WorkoutDataProvider';
import { ApiError } from '../account/api/client';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { useEffect, useState, useCallback } from 'react';
import { z } from 'zod';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  ChoiceTiles,
  Sheet,
  Skeleton,
  Stack,
  StatusIndicator,
} from '../../shared/ui';
import { useWorkoutResources, useWorkoutResource } from '../workouts/data/WorkoutDataProvider';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import { useWorkoutAction } from '../workouts/data/useWorkoutAction';
import { programSpec } from '../workouts/data/models';
import {
  ReviewSchema,
  reviewPayload,
  formatShape,
  type Decision,
  type Review,
} from './review-model';

export function WorkoutReviewSheet({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const resources = useWorkoutResources();
  const sync = useTrainingSync();
  const programs = useWorkoutResource(programSpec);
  const currentBasis = JSON.stringify(
    programs.data?.programs.find((x) => x.isActive)?.sessions.find((x) => x.id === sessionId) ??
      null,
  );
  const [basis, setBasis] = useState('');
  const outdated = !!basis && currentBasis !== basis;
  const { theme } = useTheme();
  const workouts = useWorkoutContext();
  const action = useWorkoutAction();
  const run = action.run;
  const [data, setData] = useState<Review | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [applied, setApplied] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending =
    !!resources?.changes.pendingFor(programSpec.path).length ||
    !!resources?.changes.pendingFor('/api/injuries').length;
  const review = useCallback(async () => {
    await run(async () => {
      if (!resources || pending || !sync.ready)
        throw new Error(
          'Wait for your program changes to finish uploading, then review again.',
        );
      let result: Review;
      try {
        result = ReviewSchema.parse(
          await resources.write(
            'POST',
            `/api/workout-review/session/${encodeURIComponent(sessionId)}`,
            {},
          ),
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 400)
          throw new Error(
            'Workout review needs an AI session with a completed baseline. Finish the baseline, then refresh your program.',
          );
        throw error;
      }
      if (result.sessionId !== sessionId)
        throw new Error('The session changed. Review it again.');
      setBasis(currentBasis);
      setData(result);
      setDecisions(
        Object.fromEntries(
          result.proposal.exercises
            .filter((x) => x.action !== 'keep')
            .map((x) => [x.sessionExerciseId, 'cycle']),
        ),
      );
    });
  }, [run, resources, pending, sync.ready, sessionId, currentBasis]);
  useEffect(() => {
    if (!data && !pending && sync.ready && programs.data) void review();
  }, [data, pending, sync.ready, programs.data, review]);
  const selected =
    data?.proposal.exercises.filter(
      (x) => x.action !== 'keep' && decisions[x.sessionExerciseId] !== 'reject',
    ).length ?? 0;
  async function apply() {
    if (!data || !resources || applied || uncertain) return;
    await action.run(async () => {
      if (pending || outdated)
        throw new Error(
          'Wait for your program changes to finish uploading before applying this review.',
        );
      try {
        const ack = z
          .object({
            applied: z.object({
              adjustments: z.number(),
              dropThisCycle: z.number(),
              dropPermanent: z.number(),
            }),
          })
          .parse(
            await resources.write(
              'POST',
              `/api/workout-review/session/${encodeURIComponent(sessionId)}/apply`,
              reviewPayload(data, decisions),
              [
                '/api/workout-templates',
                '/api/workout-data',
                '/api/next-session',
                '/api/ai-periodization/session/',
              ],
            ),
          );
        if (
          ack.applied.adjustments + ack.applied.dropThisCycle + ack.applied.dropPermanent ===
          0
        )
          throw new Error('The session changed. Review it again before applying.');
        setApplied(true);
        workouts.invalidate();
        await resources.load(programSpec, true);
        onClose();
      } catch {
        setUncertain(true);
        throw new Error(
          'Could not confirm the update. Reopen this review to check the current session before making another change.',
        );
      }
    });
  }
  const warmup = data ? Math.max(0, data.totalBudgetMin - data.proposal.budgetMin) : 0;
  return (
    <Sheet
      visible
      fullHeight
      title={data ? `Review · ${data.sessionName}` : 'Review workout'}
      onClose={() => {
        if (!action.busy) onClose();
      }}
      footer={
        <Stack direction="row">
          <AppButton
            title="Cancel"
            variant="secondary"
            disabled={action.busy}
            onPress={onClose}
            style={{ flex: 1 }}
          />
          {data?.proposal.exercises.some((x) => x.action !== 'keep') && (
            <AppButton
              title={`Apply ${selected}`}
              busy={action.busy}
              disabled={!selected || pending || outdated || applied || uncertain}
              onPress={() => void apply()}
              style={{ flex: 1 }}
            />
          )}
        </Stack>
      }
    >
      <StatusIndicator
        label="Workout review"
        busy={action.busy || (!data && programs.loading)}
        error={action.error ?? programs.error}
        onRetry={data ? undefined : () => void review()}
      />
      {!data && action.busy && (
        <>
          <Skeleton style={{ height: theme.sizes.recommendationCard }} />
          <AppText tone="muted">Reviewing your session against your recent data…</AppText>
        </>
      )}
      {data && (
        <>
          <Card tone={data.proposal.fitsBudget ? 'activity' : 'checkin'}>
            <AppText variant="heading">
              ≈{warmup + data.proposal.projectedDurationMin} of {data.totalBudgetMin} min —{' '}
              {data.proposal.fitsBudget ? 'fits' : 'still over'}
            </AppText>
            <AppText variant="caption" tone="muted">
              ~{warmup} min warmup + {data.proposal.projectedDurationMin} min working (≤
              {data.proposal.budgetMin} min target)
            </AppText>
          </Card>
          <AppText tone="muted">{data.reasoning}</AppText>
          <Stack direction="row" wrap>
            {Object.entries(data.proposal.weeklyImpact).map(([muscle, delta]) => (
              <Badge key={muscle} label={`${muscle} ${delta > 0 ? '+' : ''}${delta} sets/wk`} />
            ))}
          </Stack>
          {data.proposal.exercises
            .filter((x) => x.action !== 'keep' || x.guardAdjusted)
            .map((x) => (
              <Card key={x.sessionExerciseId}>
                <AppText variant="heading">{x.name}</AppText>
                <AppText variant="caption" tone="muted">
                  {x.action === 'drop'
                    ? `Drop · was ${formatShape(x.before)}`
                    : x.action === 'keep'
                      ? 'Kept to protect your training'
                      : `${formatShape(x.before)} → ${formatShape(x.after)}`}
                </AppText>
                {x.reason && (
                  <AppText variant="caption" tone="muted">
                    {x.reason}
                  </AppText>
                )}
                {x.action !== 'keep' && (
                  <ChoiceTiles
                    label={`Apply change for ${x.name}`}
                    value={decisions[x.sessionExerciseId] ?? 'reject'}
                    options={[
                      { value: 'cycle', label: 'This cycle' },
                      ...(x.action === 'drop'
                        ? [{ value: 'permanent', label: 'Permanent' }]
                        : []),
                      { value: 'reject', label: 'Skip' },
                    ]}
                    onChange={(value) =>
                      setDecisions((v) => ({ ...v, [x.sessionExerciseId]: value as Decision }))
                    }
                  />
                )}
              </Card>
            ))}
          <AppText variant="caption" tone="muted">
            {
              data.proposal.exercises.filter((x) => x.action === 'keep' && !x.guardAdjusted)
                .length
            }{' '}
            exercises kept unchanged
          </AppText>
          {outdated && (
            <AppButton
              title="Review updated session"
              variant="secondary"
              busy={action.busy}
              onPress={() => void review()}
            />
          )}
          {pending && <AppText tone="muted">Your program changes are still uploading.</AppText>}
        </>
      )}
    </Sheet>
  );
}
