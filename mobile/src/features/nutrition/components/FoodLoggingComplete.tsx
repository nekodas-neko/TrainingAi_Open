import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import { calibrationProgress, markedDayNote } from '@trainingai/shared/nutrition/calibration-progress';
import { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { AppButton, AppText, Card, Icon, Stack } from '../../../shared/ui';
import { feedback } from '../../../integrations/feedback/haptics';
import { useNutrition } from '../data/NutritionProvider';
import { failureNotice } from '../../../core/reporting/index.ts';

// The server's timestamp once synced; 'pending' while the mark waits in the outbox.
function markedAt(checkin: unknown): string | null | undefined {
  if (!checkin || typeof checkin !== 'object') return undefined;
  const value = (checkin as { foodLoggingCompletedAt?: unknown }).foodLoggingCompletedAt;
  return typeof value === 'string' ? value : value == null ? null : undefined;
}

export function FoodLoggingComplete({
  date,
  isToday,
  daysLogged,
  calibrated,
  gapMessage,
}: {
  date: string;
  isToday: boolean;
  daysLogged: number | null;
  calibrated: boolean;
  gapMessage: string | null;
}) {
  const n = useNutrition(date);
  const { theme } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Until the day's check-in arrives, an already-marked day would flash the button, and a tap
  // would re-stamp the mark time.
  const loaded = n.loaded.includes('checkin:' + date) || !!n.errors['checkin:' + date];
  const completedAt = markedAt(n.view.checkin);
  const complete = completedAt != null;
  const time =
    completedAt && completedAt !== 'pending' && Number.isFinite(Date.parse(completedAt))
      ? formatTimeOfDay(completedAt, n.timezone)
      : null;
  const progress = calibrationProgress(daysLogged, calibrated, undefined, gapMessage);
  async function set(next: boolean) {
    setBusy(true);
    try {
      await n.store?.queueHttp('complete', date, { date, complete: next });
      feedback('success');
      setError(null);
    } catch (failure) {
      setError(
        failureNotice(next ? 'Could not mark the day complete.' : 'Could not undo.', failure),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      {complete ? (
        <Stack direction="row" align="center">
          <Icon name="check" color={theme.colors.brand} />
          <Stack gap="xs" style={{ flex: 1 }}>
            <AppText variant="label">Logging finished{isToday ? ' for today' : ''}</AppText>
            <AppText variant="caption" tone="muted">
              {markedDayNote(isToday)}
              {time ? ` · marked ${time}` : ''}
            </AppText>
          </Stack>
          <AppButton title="Undo" variant="ghost" busy={busy} onPress={() => void set(false)} />
        </Stack>
      ) : (
        <>
          <Stack direction="row" align="flex-start">
            <Icon name="sets" tone="muted" />
            <Stack gap="xs" style={{ flex: 1 }}>
              <AppText variant="label">
                Finished logging{isToday ? ' for today' : ' this day'}?
              </AppText>
              <AppText variant="caption" tone="muted">
                Only days you mark are used to work out what you burn. A day you stop logging
                halfway through would otherwise look like a light day and drag the estimate down.
              </AppText>
            </Stack>
          </Stack>
          <AppButton
            title={loaded ? 'I’ve finished logging' : ''}
            busy={busy || !loaded}
            onPress={() => void set(true)}
          />
        </>
      )}
      {error && (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      )}
      {progress && (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            paddingTop: theme.spacing.sm,
          }}
        >
          <AppText variant="caption" tone="muted">
            <AppText
              variant="caption"
              style={{ fontWeight: theme.typography.subheading.fontWeight }}
            >
              {progress.count}
            </AppText>{' '}
            {progress.detail}
          </AppText>
        </View>
      )}
    </Card>
  );
}
