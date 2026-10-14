import type { MealLoggingStatus } from '@trainingai/shared/nutrition/meal-logging-status';
import { useRef, useState } from 'react';
import { Pressable } from 'react-native';
import { AppText, DisclosureIcon, IconButton, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { mealStatusLabels } from './MealLoggingStatus';

export function MealSectionHeader({
  name,
  status,
  calories,
  expanded,
  onToggle,
  onAdd,
  onSkip,
}: {
  name: string;
  status: MealLoggingStatus;
  calories?: number;
  expanded: boolean;
  onToggle?: () => void;
  onAdd: () => void;
  onSkip: (skipped: boolean) => Promise<void>;
}) {
  const { theme } = useTheme();
  const [busy, setBusy] = useState(false);
  const changing = useRef(false);
  const summary = `${mealStatusLabels[status]}${calories == null ? '' : ` · ${Math.round(calories).toLocaleString()} kcal`}`;
  async function skip() {
    if (changing.current) return;
    changing.current = true;
    setBusy(true);
    try {
      await onSkip(status !== 'skipped');
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }
  const label = (
    <Stack gap="xxs">
      <AppText variant="label" numberOfLines={2}>
        {name}
      </AppText>
      <AppText
        variant="caption"
        style={{
          color: status === 'skipped' ? theme.tones.checkin.foreground : theme.colors.muted,
        }}
      >
        {summary}
      </AppText>
    </Stack>
  );
  return (
    <Stack
      direction="row"
      align="center"
      gap="xs"
      style={{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }}
    >
      {onToggle ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={name}
          accessibilityValue={{ text: summary }}
          accessibilityState={{ expanded }}
          accessibilityHint={expanded ? 'Collapse recorded food' : 'Expand recorded food'}
          onPress={onToggle}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            minHeight: theme.sizes.touchTarget,
            justifyContent: 'center',
            opacity: pressed ? 0.65 : 1,
          })}
        >
          {label}
        </Pressable>
      ) : (
        <Stack style={{ flex: 1, minWidth: 0 }}>{label}</Stack>
      )}
      <Stack direction="row" gap="none" align="center">
        <IconButton icon="plus" tone="brand" label={`Add food to ${name}`} onPress={onAdd} />
        {onToggle ? (
          <IconButton
            icon="expand"
            label={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
            expanded={expanded}
            onPress={onToggle}
          >
            <DisclosureIcon expanded={expanded} />
          </IconButton>
        ) : status !== 'recorded' ? (
          <IconButton
            icon={status === 'skipped' ? 'undo' : 'skip'}
            tone={status === 'skipped' ? 'brand' : 'muted'}
            label={status === 'skipped' ? `Undo skipped ${name}` : `Skip ${name}`}
            hint={
              status === 'skipped'
                ? 'Mark this meal as not recorded'
                : 'I did not eat this meal'
            }
            busy={busy}
            onPress={() => void skip()}
          />
        ) : null}
      </Stack>
    </Stack>
  );
}
