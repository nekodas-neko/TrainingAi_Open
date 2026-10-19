import { View } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';

// `ruled` is the Health Training legend (calendar-widget.tsx, weekly-stats-hub.tsx): a rule above,
// 6 px dots, 12 px between items and 4 px between lines. `tinted` colours each label like its dot
// (the weekly card) and `centered` centres the row (the calendar).
export function Legend({
  items,
  ruled = false,
  tinted = false,
  centered = false,
}: {
  items: readonly { label: string; color: string }[];
  ruled?: boolean;
  tinted?: boolean;
  centered?: boolean;
}) {
  const { theme } = useTheme();
  const dot = ruled ? theme.sizes.legendDot : theme.spacing.sm;
  return (
    <Stack
      direction="row"
      wrap
      gap="md"
      justify={centered ? 'center' : undefined}
      style={
        ruled
          ? {
              rowGap: theme.spacing.xs,
              paddingTop: theme.spacing.sm,
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
            }
          : undefined
      }
    >
      {items.map((item) => (
        <Stack key={item.label} direction="row" align="center" gap="xs">
          <View
            style={{
              width: dot,
              height: dot,
              borderRadius: theme.radii.pill,
              backgroundColor: item.color,
            }}
          />
          <AppText
            variant="micro"
            tone="muted"
            style={tinted ? { color: item.color } : undefined}
          >
            {item.label}
          </AppText>
        </Stack>
      ))}
    </Stack>
  );
}
