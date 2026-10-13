import { useState } from 'react';
import { AppButton } from './AppButton';
import { ListRow } from './ListRow';
import { Sheet } from './Sheet';
import { TextField } from './TextField';

export function Picker({
  label,
  value,
  options,
  onChange,
  disabled = false,
  searchable = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; subtitle?: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((option) => option.value === value);
  return (
    <>
      <AppButton
        title={`${label}: ${selected?.label ?? 'Choose'}`}
        accessibilityLabel={label}
        variant="surface"
        disabled={disabled}
        onPress={() => {
          setSearch('');
          setOpen(true);
        }}
      />
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
