import { View } from 'react-native';
import { TouchSurface } from './TouchSurface';
import { AppText } from './AppText';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';
import type { Tone } from '../theme/theme';

export function HubCard({
  title,
  subtitle,
  icon,
  tone = 'brand',
  badge,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: IconName;
  tone?: Tone;
  /** A small label beside the title, e.g. PROGRAM. */
  badge?: string;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  const palette = theme.tones[tone];
  return (
    <TouchSurface
      accessibilityRole="button"
      accessibilityLabel={`${title}${onPress ? '' : ', coming soon'}`}
      accessibilityState={{ disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress}
    >
      <Card tone={tone} style={{ padding: theme.spacing.md }}>
        <Stack direction="row" align="center">
          <View
            style={{
              width: theme.sizes.touchTarget,
              height: theme.sizes.touchTarget,
              borderRadius: theme.radii.control,
              backgroundColor: palette.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={icon} color={palette.foreground} />
          </View>
          <View style={{ flex: 1 }}>
            <Stack direction="row" align="center" justify="space-between">
              <Stack direction="row" align="center" gap="xs" style={{ flexShrink: 1 }}>
                <AppText variant="heading">{title}</AppText>
                {badge && (
                  <View
                    style={{
                      borderRadius: theme.radii.small,
                      backgroundColor: palette.border,
                      paddingHorizontal: theme.spacing.xs,
                    }}
                  >
                    <AppText variant="micro" style={{ color: theme.colors.text }}>
                      {badge.toUpperCase()}
                    </AppText>
                  </View>
                )}
              </Stack>
              {!onPress && (
                <AppText variant="micro" tone="muted">
                  Coming soon
                </AppText>
              )}
            </Stack>
            <AppText variant="caption" tone="muted">
              {subtitle}
            </AppText>
          </View>
          <Icon name="forward" tone="muted" size={theme.sizes.iconSmall} />
        </Stack>
      </Card>
    </TouchSurface>
  );
}
