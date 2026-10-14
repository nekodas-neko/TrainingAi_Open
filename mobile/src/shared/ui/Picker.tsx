import { useState } from 'react';
import { AppButton } from './AppButton';
import { ListRow } from './ListRow';
import { Sheet } from './Sheet';
import { TextField } from './TextField';
import { Stack } from './Stack';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';

export function Picker({
  label,
  value,
  options,
  onChange,
  disabled = false,
  searchable = false,
  compact = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; subtitle?: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
  compact?: boolean;
}) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((option) => option.value === value);
  return (
    <>
      <Stack gap="xs">
        {compact && (
          <AppText variant="caption" tone="muted">
            {label}
          </AppText>
        )}
        <AppButton
          title={
            compact ? (selected?.label ?? 'Choose') : `${label}: ${selected?.label ?? 'Choose'}`
          }
          style={
            compact
              ? {
                  minHeight: theme.sizes.touchTarget,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.sm,
                }
              : undefined
          }
          accessibilityLabel={label}
          variant="surface"
          disabled={disabled}
          onPress={() => {
            setSearch('');
            setOpen(true);
          }}
        />
      </Stack>
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        {searchable && <TextField label="Search" value={search} onChangeText={setSearch} />}
        {options
          .filter((option) =>
            `${option.label} ${option.subtitle ?? ''}`.toLowerCase().includes(search.toLowerCase()),
          )
          .map((option) => (
            <ListRow
              key={option.value}
              title={`${option.label}${option.value === value ? ' ✓' : ''}`}
              subtitle={option.subtitle}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
            />
          ))}
      </Sheet>
    </>
  );
}
