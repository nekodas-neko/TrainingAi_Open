import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { CURRENT_VS_QUESTION } from '@trainingai/shared/types/day-checkin';
import { AppText, Card, Stack, StatusIndicator } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { readinessVerdictSpec } from '../../health/data/checkin';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useHome } from '../data/HomeProvider';
import {
  FEEL_OPTIONS,
  feelCheckin,
  readinessPrompt,
  respondedToday,
  type Feel,
} from '../data/readiness-prompt';
import { failureNotice } from '../../../core/reporting/index.ts';

/**
 * Home's readiness card (#2106): a statement on a usual day, a question only when the score is
 * outside the user's own band. Soreness logging stays one tap away every day, because it still
 * lightens that day's loads. `logged` is the card as it already showed an energy log.
 */
export function ReadinessPromptCard({
  openReadiness,
  logged,
}: {
  openReadiness: () => void;
  logged: ReactNode;
}) {
  const { theme } = useTheme();
  const health = useHealthData();
  const home = useHome();
  const verdict = useWorkoutResource(readinessVerdictSpec(health.today));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = health.operations.filter(
    (op) => op.domain === 'day_checkins' && op.date === health.today,
  );
  const row = pending.at(-1)?.payload ?? health.checkins[health.today] ?? null;
  const feelAnswered =
    row?.vsNormal != null && (row.vsNormalTouched as boolean | null | undefined) === true;
  // A skip lives only in `readinessResponses` (until the POST lands), so offline or in flight it is
  // the only record that the question was dealt with today.
  const prompt = readinessPrompt(
    verdict.data?.verdict,
    feelAnswered || respondedToday(health.readinessResponses, health.today),
  );
  async function answer(feel: Feel | null) {
    if (!health.store || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (feel) {
        await health.store.saveCheckin(
          health.today,
          feelCheckin(row, feel, CURRENT_VS_QUESTION) as Parameters<
            typeof health.store.saveCheckin
          >[1],
        );
      }
      await health.store.respondToReadiness(health.today, feel ? 'rated' : 'dismissed');
      verdict.refresh();
    } catch (failure) {
      setError(failureNotice('Could not save your answer on this phone. Try again.', failure));
    } finally {
      setBusy(false);
    }
  }
  const soreness = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Log soreness"
      onPress={openReadiness}
      hitSlop={theme.spacing.xs}
      style={({ pressed }) => ({
        minHeight: theme.sizes.touchTarget,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radii.pill,
        backgroundColor: theme.colors.raised,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <AppText variant="label">Log soreness</AppText>
    </Pressable>
  );
  if (prompt.kind === 'ask') {
    return (
      <Card tone="checkin">
        <AppText variant="eyebrow" style={{ color: theme.tones.checkin.foreground }}>
          {prompt.eyebrow}
        </AppText>
        <AppText variant="heading">{prompt.title}</AppText>
        <Stack direction="row" gap="xs" accessibilityRole="radiogroup" accessibilityLabel="How you feel compared with usual">
          {FEEL_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: false, disabled: busy }}
              disabled={busy}
              onPress={() => void answer(option.value)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: theme.sizes.touchTarget,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: theme.spacing.xs,
                paddingVertical: theme.spacing.xs,
                borderRadius: theme.radii.pill,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.raised,
                opacity: pressed || busy ? 0.65 : 1,
              })}
            >
              {/* Three pills share ~103 dp at 384 px: "About the same" wraps rather than clips. */}
              <AppText variant="label" style={{ textAlign: 'center' }}>
                {option.label}
              </AppText>
            </Pressable>
          ))}
        </Stack>
        <Stack direction="row" align="center" justify="space-between">
          {soreness}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip the readiness question"
            disabled={busy}
            onPress={() => void answer(null)}
            style={{
              minHeight: theme.sizes.touchTarget,
              minWidth: theme.sizes.touchTarget,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AppText variant="caption" tone="muted">
              Not now
            </AppText>
          </Pressable>
        </Stack>
        {error && (
          <StatusIndicator label="Readiness question" error={error} />
        )}
      </Card>
    );
  }
  // An energy log already on the card is more than the one line says, so it stays.
  if (home.mood) {
    return <>{logged}</>;
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.radii.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: `${theme.colors.raised}80`,
      }}
    >
      <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
        {prompt.kind === 'usual' ? `${prompt.line} Sore somewhere?` : 'Sore somewhere?'}
      </AppText>
      {soreness}
    </View>
  );
}
