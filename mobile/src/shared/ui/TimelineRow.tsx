import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { Stack } from './Stack';

export type TimelineRowMetric = {
  icon?: IconName;
  iconColor?: string;
  text: string;
  emphasis?: boolean;
};

/**
 * One event on Home's timeline, as home-day-timeline.tsx EventRow draws it: an outlined round icon
 * on a spine, and beside it the time over a card holding the title and a row of small figures.
 */
export function TimelineRow({
  time,
  timeInline = false,
  title,
  metrics = [],
  icon,
  color,
  last,
  savedLocally = false,
  onPress,
}: {
  time: string;
  /** The current app's wake-up row prints the time bold beside the title, not on a line above it. */
  timeInline?: boolean;
  title: string;
  metrics?: TimelineRowMetric[];
  icon: IconName;
  color: string;
  last: boolean;
  savedLocally?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const marker = theme.sizes.timelineMarker;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        time,
        title,
        ...metrics.map((metric) => metric.text),
        savedLocally ? 'Saved on this phone' : null,
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint="View event details"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: theme.spacing.md,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <View style={{ width: marker + theme.spacing.xs, alignItems: 'center' }}>
        <View
          style={{
            width: marker,
            height: marker,
            borderRadius: theme.radii.pill,
            borderWidth: 1,
            borderColor: `${color}66`,
            backgroundColor: `${color}33`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={theme.sizes.iconCompact} color={color} />
        </View>
        {!last && (
          <View
            style={{
              flex: 1,
              width: 1,
              marginVertical: theme.spacing.xs,
              backgroundColor: theme.colors.border,
              opacity: 0.5,
            }}
          />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : theme.spacing.lg }}>
        {!timeInline && (
          <AppText
            variant="factorLabel"
            tone="muted"
            style={{
              fontVariant: ['tabular-nums'],
              marginBottom: theme.spacing.xs + theme.spacing.xxs,
            }}
          >
            {time}
          </AppText>
        )}
        <View
          style={{
            borderRadius: theme.radii.control,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: `${theme.colors.raised}66`,
            padding: theme.spacing.md,
            gap: theme.spacing.sm,
          }}
        >
          <Stack direction="row" align="center" gap="sm">
            <AppText variant="subheading" style={{ flexShrink: 1 }}>
              {title}
            </AppText>
            {timeInline && (
              <AppText
                variant="subheading"
                style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}
              >
                {time}
              </AppText>
            )}
            {savedLocally && (
              <Icon name="history" size={theme.spacing.md} color={theme.tones.checkin.foreground} />
            )}
          </Stack>
          {metrics.length > 0 && (
            <Stack direction="row" wrap gap="md" align="center">
              {metrics.map((metric, index) => (
                <Stack key={index} direction="row" align="center" gap="xs">
                  {metric.icon && (
                    <Icon
                      name={metric.icon}
                      size={theme.sizes.iconCompact - theme.spacing.xs}
                      color={metric.iconColor ?? theme.colors.muted}
                    />
                  )}
                  <AppText
                    variant="caption"
                    tone={metric.emphasis ? 'text' : 'muted'}
                    style={metric.emphasis ? { fontWeight: '500' } : undefined}
                  >
                    {metric.text}
                  </AppText>
                </Stack>
              ))}
            </Stack>
          )}
        </View>
      </View>
    </Pressable>
  );
}
