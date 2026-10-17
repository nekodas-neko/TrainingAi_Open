import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Tone } from '../theme/theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { Stack } from './Stack';

export function TimelineRow({
  time,
  showTime = true,
  title,
  summary,
  icon,
  tone = 'brand',
  color,
  first,
  last,
  savedLocally = false,
  onPress,
}: {
  time: string;
  /** The current app prints no time on a wake-up row; the time still reaches screen readers. */
  showTime?: boolean;
  title: string;
  summary?: string;
  icon: IconName;
  tone?: Tone;
  color?: string;
  first: boolean;
  last: boolean;
  savedLocally?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const marker = theme.sizes.timelineMarker;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[time, title, summary, savedLocally ? 'Saved on this phone' : null]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint="View event details"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        minHeight: theme.sizes.timelineRow,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <View
        style={{
          width: marker,
          alignSelf: 'stretch',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {!first && (
          <View
            style={{
              position: 'absolute',
              width: 1,
              top: 0,
              height: '50%',
              backgroundColor: theme.colors.border,
            }}
          />
        )}
        {!last && (
          <View
            style={{
              position: 'absolute',
              width: 1,
              bottom: 0,
              height: '50%',
              backgroundColor: theme.colors.border,
            }}
          />
        )}
        <View
          style={{
            width: marker,
            height: marker,
            borderRadius: theme.radii.small,
            backgroundColor: theme.tones[tone].background,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon
            name={icon}
            size={theme.sizes.iconSmall}
            color={color ?? theme.tones[tone].foreground}
          />
        </View>
      </View>
      <Stack gap="xxs" style={{ flex: 1, minWidth: 0, paddingVertical: theme.spacing.sm }}>
        {showTime && (
          <AppText variant="micro" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
            {time}
          </AppText>
        )}
        <Stack direction="row" align="center" gap="xs">
          <AppText variant="label" numberOfLines={2} style={{ flexShrink: 1 }}>
            {title}
          </AppText>
          {savedLocally && (
            <Icon
              name="history"
              size={theme.spacing.md}
              color={theme.tones.checkin.foreground}
            />
          )}
        </Stack>
        {!!summary && (
          <AppText variant="caption" tone="muted" numberOfLines={2}>
            {summary}
          </AppText>
        )}
      </Stack>
    </Pressable>
  );
}
