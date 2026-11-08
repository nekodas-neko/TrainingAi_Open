import { useState } from 'react';
import { AppText, SwitchRow } from '../../../shared/ui';
import { useHomeState } from '../../home/data/HomeProvider';

/**
 * The current app's two account-wide reminder switches (#3653), saved on the account as the current
 * app saves them (`mealReminders`, `dayReviewReminders`), so turning one off in either app turns it
 * off in both. Unset reads as on, as it does there.
 */
const rows = {
  mealReminders: {
    label: 'Remind me to log meals',
    caption: 'Get a notification if a meal window ends with nothing logged',
  },
  dayReviewReminders: {
    label: 'Day & week review reminders',
    caption: 'Wind-down nudge before bed, weekly recap on Sunday',
  },
} as const;

export function ReminderPreferenceSwitch({ name }: { name: keyof typeof rows }) {
  const { store, preferences, denied } = useHomeState();
  const [error, setError] = useState<string | null>(null);
  const row = rows[name];
  return (
    <>
      <SwitchRow
        label={row.label}
        value={preferences[name] !== false}
        disabled={!store || denied}
        onValueChange={(value) => {
          setError(null);
          void store
            ?.savePreferences({ [name]: value })
            .catch(() => setError('Could not save this setting. Try again.'));
        }}
      />
      <AppText variant="caption" tone="muted">
        {row.caption}
      </AppText>
      {error && (
        <AppText variant="caption" tone="muted" accessibilityRole="alert">
          {error}
        </AppText>
      )}
    </>
  );
}
