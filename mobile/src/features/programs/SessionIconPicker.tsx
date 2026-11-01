import { useState } from 'react';
import { SESSION_ICON_CHOICES } from '@trainingai/shared/session-icons';
import { AppButton, IconTileGrid, Sheet, Stack, AppText } from '../../shared/ui';
import { sessionIconOptions } from '../workouts/components/session-icon-names';

export const DEFAULT_SESSION_ICON = '💪';

export function SessionIconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = SESSION_ICON_CHOICES.find((choice) => choice.emoji === value);
  return (
    <>
      <Stack gap="xs">
        <AppText variant="caption" tone="muted">
          Icon
        </AppText>
        <AppButton
          title={selected?.label ?? 'Choose'}
          accessibilityLabel="Icon"
          variant="surface"
          onPress={() => setOpen(true)}
        />
      </Stack>
      <Sheet visible={open} title="Icon" onClose={() => setOpen(false)}>
        <IconTileGrid
          options={sessionIconOptions()}
          selectedId={value}
          onSelect={(emoji) => {
            onChange(emoji);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}
