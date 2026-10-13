import { FITNESS_TEST_PROTOCOLS } from '@trainingai/shared/fitness-tests/protocols';
import {
  AppText,
  Card,
  Disclosure,
  KeyValueGrid,
  ListRow,
  PageLayout,
  StableContent,
  StatusIndicator,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutAction } from '../../workouts/data/useWorkoutAction';
import { useActivities } from '../data/ActivityProvider';
import { baselinesSpec } from '../data/models';
import { randomUUID } from 'expo-crypto';
export function BaselinesScreen({
  onBack,
  openActivity,
}: {
  onBack: () => void;
  openActivity: () => void;
}) {
  const state = useWorkoutResource(baselinesSpec),
    activity = useActivities(),
    action = useWorkoutAction();
  const entries = new Map((state.data?.fitnessTests ?? []).map((row) => [row.id, row]));
  for (const row of activity.tests) {
    if (row.pending || !entries.has(row.payload.id)) {
      entries.set(row.payload.id, row.payload);
    }
  }
  const records = [...entries.values()].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <PageLayout
      title="Fitness Baselines"
      onBack={onBack}
      scroll
      actions={
        <StatusIndicator
          label="Fitness tests"
          error={action.error ?? state.error ?? activity.error}
          busy={action.busy || activity.syncing}
          message={
            activity.tests.some((row) => row.pending)
              ? 'Test results saved on this phone.'
              : null
          }
          onRetry={() => {
            state.refresh();
            void activity.store?.sync();
          }}
        />
      }
    >
      <AppText tone="muted">Measure your cardio fitness. Repeat later to see progress.</AppText>
      <StableContent minHeight={340} loading={!state.data && state.loading}>
        {FITNESS_TEST_PROTOCOLS.map((protocol) => {
          const last = records.find((row) => row.testType === protocol.id),
            value = protocol.vo2Equation ? last?.vo2maxEst : last?.hrr1Bpm;
          return (
            <Card key={protocol.id}>
              <ListRow
                title={protocol.name}
                subtitle={protocol.description}
                disabled={!activity.ready || action.busy}
                onPress={() =>
                  activity.session
                    ? openActivity()
                    : void action.run(async () => {
                        await activity.store!.start(
                          {
                            id: protocol.activityType ?? 'other',
                            label: protocol.name,
                            icon: 'Activity',
                            isDistanceBased: protocol.captureDistance,
                          },
                          {
                            kind: 'test',
                            protocol: protocol.id,
                            activityId: randomUUID(),
                            countdownUntil: Date.now() + 3000,
                            restingHr: '',
                            peakHr: '',
                            recoveryHr: '',
                            saved: false,
                          },
                        );
                        openActivity();
                      })
                }
              />
              {value != null && (
                <AppText variant="caption" tone="brand">
                  Last: {value} {protocol.vo2Equation ? 'VO₂max' : 'HRR bpm'} · {last!.date}
                </AppText>
              )}
              {records.some((row) => row.testType === protocol.id) && (
                <Disclosure title="Previous results">
                  {records
                    .filter((row) => row.testType === protocol.id)
                    .map((row) => (
                      <KeyValueGrid
                        key={row.id}
                        rows={[
                          { label: 'Date', value: row.date },
                          {
                            label: protocol.vo2Equation ? 'VO₂max' : 'HRR',
                            value: String(
                              (protocol.vo2Equation ? row.vo2maxEst : row.hrr1Bpm) ?? '—',
                            ),
                          },
                          {
                            label: 'Distance',
                            value: row.distanceM == null ? '—' : `${row.distanceM} m`,
                          },
                          {
                            label: 'Duration',
                            value: row.durationSec == null ? '—' : `${row.durationSec} sec`,
                          },
                        ]}
                      />
                    ))}
                </Disclosure>
              )}
            </Card>
          );
        })}
        {!state.connected && <AppText tone="muted">Sign in to save fitness tests.</AppText>}
      </StableContent>
    </PageLayout>
  );
}
