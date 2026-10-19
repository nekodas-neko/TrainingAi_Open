import { useEffect, useState } from 'react';
import { z } from 'zod';
import { AppText, Card, Icon, IconButton, Stack, StableContent } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useHealthData } from '../data/HealthDataProvider';
import { failureNotice } from '../../../core/reporting/index.ts';
const savedInsight = z.object({ insight: z.string(), savedAt: z.number() });
export function HealthInsight({
  section,
  hasData,
}: {
  section: 'readiness' | 'sleep' | 'activity' | 'heart-rate';
  hasData: boolean;
}) {
  const resources = useWorkoutResources();
  const { theme } = useTheme();
  const { today, operations } = useHealthData();
  const [insight, setInsight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(hasData && !operations.length);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (!resources || !hasData || operations.length) {
      return;
    }
    const key = `health-insight:${section}:${today}`;
    setBusy(true);
    void (async () => {
      try {
        const cached = await resources.draft(key, savedInsight);
        if (active && cached) {
          setInsight(cached.insight);
        }
        if (cached && Date.now() - cached.savedAt < 6 * 60 * 60_000 && !revision) {
          return;
        }
        const result = z
          .object({ insight: z.string(), degraded: z.boolean().optional() })
          .parse(
            await resources.write('POST', '/api/ai/health-insight', {
              section,
              date: today,
              force: revision > 0,
            }),
          );
        if (active) {
          setInsight(result.insight);
          setError(null);
        }
        if (!result.degraded) {
          await resources.saveDraft(key, {
            insight: result.insight,
            savedAt: Date.now(),
          });
        }
      } catch (failure) {
        if (active) {
          setError(
            failureNotice('Could not refresh this insight. Try again when connected.', failure),
          );
        }
      } finally {
        if (active) {
          setBusy(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [resources, section, today, hasData, revision, operations.length]);
  if (!hasData) {
    return null;
  }
  return (
    <Card>
      <Stack direction="row" justify="space-between" align="center">
        <Stack direction="row" align="center" gap="xs">
          <Icon name="coach" size={theme.sizes.iconSmall} color={theme.scores.sleep} />
          <AppText variant="eyebrow" tone="muted">
            AI Insight
          </AppText>
        </Stack>
        <IconButton
          icon="refresh"
          label="Refresh insight"
          busy={busy}
          disabled={operations.length > 0}
          onPress={() => setRevision((value) => value + 1)}
        />
      </Stack>
      <StableContent
        loading={!insight && busy}
        minHeight={theme.typography.body.lineHeight! * 3}
      >
        <AppText>
          {insight
            ? insight
            : error
              ? error
              : operations.length
                ? 'Insight will update after your changes upload.'
                : 'No insight available yet.'}
        </AppText>
      </StableContent>
      {error && insight && (
        <AppText variant="micro" tone="muted">
          {error}
        </AppText>
      )}
    </Card>
  );
}
