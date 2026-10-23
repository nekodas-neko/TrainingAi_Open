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
  /** `shape` square (a key swatch), dot (default) or text (a note with no swatch); `outlined` rings the swatch. */
  items: readonly {
    label: string;
    color?: string;
    shape?: 'dot' | 'square' | 'text';
    outlined?: boolean;
  }[];
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
          {item.shape !== 'text' && (
            <View
              style={{
                width: item.shape === 'square' ? theme.sizes.legendSwatch : dot,
                height: item.shape === 'square' ? theme.sizes.legendSwatch : dot,
                borderRadius: item.shape === 'square' ? theme.radii.swatch : theme.radii.pill,
                backgroundColor: item.color,
                borderWidth: item.outlined ? 1 : 0,
                borderColor: theme.colors.border,
              }}
            />
          )}
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
