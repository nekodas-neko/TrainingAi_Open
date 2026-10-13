import { useState } from 'react';
import { AppButton, AppText, Stack } from '../../../shared/ui';
import { usePlatformIntegrations } from '../PlatformProvider';
import type { WorkoutRecord } from '../../workouts/logging/workout';
import { openCalendarEvent } from '../../../integrations/calendar/platform';
export function WorkoutCalendarAction({ workout }: { workout: WorkoutRecord }) {
  const { state, calendar, calendarState } = usePlatformIntegrations();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const linked = calendarState?.events[workout.id];
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not update the calendar. Your workout is saved.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <AppButton
        title={linked ? 'View calendar event' : 'Add to calendar'}
        icon="calendar"
        variant="secondary"
        busy={busy}
        disabled={!linked && !state?.settings.calendarId}
        onPress={() =>
          void run(() =>
            linked
              ? openCalendarEvent(linked.id)
              : calendar!.add(workout, state!.settings.calendarId!),
          )
        }
      />
      {!linked && !state?.settings.calendarId && (
        <AppText variant="caption" tone="muted">
          Choose a calendar in More → Account & settings → Alerts & calendar.
        </AppText>
      )}
      {linked && (
        <AppButton
          title="Remove calendar event"
          variant="ghost"
          busy={busy}
          onPress={() => void run(() => calendar!.remove(workout.id))}
        />
      )}
      {(error || calendarState?.error) && (
        <AppText variant="caption" tone="muted" accessibilityRole="alert">
          {error ?? calendarState?.error}
        </AppText>
      )}
    </Stack>
  );
}
