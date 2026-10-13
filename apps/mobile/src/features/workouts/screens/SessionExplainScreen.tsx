import { groupSignals } from '@trainingai/shared/session-explain/group-signals';
import {
  AppText,
  Badge,
  Card,
  Disclosure,
  ScoreRing,
  Skeleton,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { healthCopy } from '../../health/data/display-copy';
import { WorkoutLayout } from '../components/WorkoutLayout';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { explanationSpec, explanationData, insightSpec } from '../data/explanation';
export function SessionExplainScreen({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: () => void;
}) {
  const { today } = useHealthData();
  const { theme } = useTheme();
  const explanation = useWorkoutResource(explanationSpec(today));
  const data = explanationData(explanation.data, sessionId);
  const insight = useWorkoutResource(
    insightSpec(today, sessionId, data),
    !!data && explanation.data?.session?.id === data.session.id,
  );
  return (
    <WorkoutLayout
      title={data ? `Why ${data.session.name}?` : 'Why this session?'}
      onBack={onBack}
    >
      <StatusIndicator
        label="Recommendation"
        busy={explanation.refreshing}
        error={explanation.error}
        onRetry={explanation.refresh}
      />
      {!explanation.data && <Skeleton style={{ height: theme.sizes.recommendationCard }} />}
      {data ? (
        <>
          <Card tone="checkin">
            <AppText variant="eyebrow">Why this session</AppText>
            {insight.data ? (
              <AppText>{healthCopy(insight.data)}</AppText>
            ) : (
              <AppText tone="muted">{healthCopy(explanation.data!.reason)}</AppText>
            )}
            <StatusIndicator
              label="Workout insight"
              busy={
                explanation.data?.session?.id === data.session.id &&
                (insight.loading || insight.refreshing)
              }
              error={insight.error}
              onRetry={insight.refresh}
            />
          </Card>
          <Card>
            <ScoreRing value={data.overallScore} label="Session fit" />
            <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              How well this session fits today
            </AppText>
          </Card>
          <Disclosure title="The signals behind this">
            {groupSignals(data).map((group) => (
              <Card key={group.heading}>
                <AppText variant="heading">{healthCopy(group.heading)}</AppText>
                {group.rows.map((row) => (
                  <Stack key={row.label} gap="xs">
                    <Stack direction="row" justify="space-between">
                      <AppText variant="label">{healthCopy(row.label)}</AppText>
                      <AppText
                        variant="caption"
                        tone="muted"
                        style={{ flex: 1, textAlign: 'right' }}
                      >
                        {row.value}
                      </AppText>
                    </Stack>
                    {row.chip && (
                      <Badge
                        label={row.chip.text}
                        tone={row.chip.tone === 'ok' ? 'activity' : 'checkin'}
                      />
                    )}
                  </Stack>
                ))}
              </Card>
            ))}
            <Card>
              <AppText variant="heading">Score components</AppText>
              {Object.entries(data.weightedComponents).map(([name, value]) => (
                <AppText key={name} variant="caption" tone="muted">
                  {name[0].toUpperCase() + name.slice(1)} · {Math.round(value.score)} ·{' '}
                  {Math.round(value.weight * 100)}% weight
                </AppText>
              ))}
            </Card>
          </Disclosure>
          {!!data.alternatives.length && (
            <Card>
              <AppText variant="heading">Other sessions</AppText>
              {data.alternatives.map((x) => (
                <Stack key={x.session.id} gap="xs">
                  <Stack direction="row" justify="space-between">
                    <AppText variant="label">{x.session.name}</AppText>
                    <Badge label={`${Math.round(x.overallScore)}`} />
                  </Stack>
                  <AppText variant="caption" tone="muted">
                    {x.primaryReason}
                  </AppText>
                </Stack>
              ))}
            </Card>
          )}
        </>
      ) : (
        explanation.data && (
          <Card>
            <AppText>{healthCopy(explanation.data.reason)}</AppText>
            <AppText variant="caption" tone="muted">
              This schedule does not use the AI session-fit score.
            </AppText>
          </Card>
        )
      )}
    </WorkoutLayout>
  );
}
