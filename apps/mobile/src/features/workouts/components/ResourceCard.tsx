import { useState, type ReactNode } from 'react';
import { AppButton, AppText, Card, Notice, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import type { ResourceSpec } from '../data/WorkoutResources';

export function ResourceCard<T>({
  title,
  spec,
  disabled = false,
  children,
}: {
  title: string;
  spec: ResourceSpec<T>;
  disabled?: boolean;
  children: (data: T) => ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  const { theme } = useTheme();
  const state = useWorkoutResource(spec, opened && !disabled);
  return (
    <Card style={{ width: '100%', maxWidth: theme.sizes.summaryWidth }}>
      <Stack direction="row" justify="space-between" align="center">
        <AppText variant="eyebrow" tone="muted">
          {title}
        </AppText>
        <AppButton
          title={state.data ? 'Refresh' : 'Show'}
          variant="ghost"
          busy={(opened && state.loading) || state.refreshing}
          disabled={disabled}
          onPress={() => {
            if (opened) {
              state.refresh();
            } else {
              setOpened(true);
            }
          }}
        />
      </Stack>
      {disabled ? (
        <AppText variant="micro" tone="muted">
          Available after this workout uploads.
        </AppText>
      ) : state.data ? (
        children(state.data)
      ) : opened && state.error ? (
        <Notice title="Could not load" message={state.error} />
      ) : opened ? (
        <AppText variant="caption" tone="muted">
          Loading…
        </AppText>
      ) : null}
    </Card>
  );
}
