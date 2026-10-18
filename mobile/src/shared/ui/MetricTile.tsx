import { View } from 'react-native';
import { Card } from './Card';
import { AppText } from './AppText';
import type { Tone } from '../theme/theme';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';

export function MetricTile({
  label,
  value,
  caption,
  unit,
  tone = 'brand',
  compact = false,
  icon,
  color,
  captionColor,
  stat = false,
  emphasize = false,
}: {
  label: string;
  value: string | null;
  caption?: string;
  unit?: string;
  tone?: Tone;
  compact?: boolean;
  icon?: IconName;
  color?: string;
  captionColor?: string;
  // The Heart rate card's tile (observed-hr-card.tsx Stat): a dark inset with a tiny uppercase
  // label over the value over its unit, in place of a toned card with a large number.
  stat?: boolean;
  // Larger bold value for the tile that leads the row.
  emphasize?: boolean;
}) {
  const { theme } = useTheme();
  if (stat) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          padding: theme.spacing.sm,
          borderRadius: theme.radii.small,
          // bg-background/40
          backgroundColor: `${theme.colors.background}66`,
        }}
      >
        <AppText variant="statLabel" tone="muted" style={{ textAlign: 'center' }}>
          {label}
        </AppText>
        <AppText
          variant={emphasize ? 'statValueStrong' : 'statValue'}
          tone={value === null ? 'muted' : 'text'}
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {value ?? '—'}
        </AppText>
        {unit && (
          <AppText variant="statUnit" tone="muted">
            {unit}
          </AppText>
        )}
      </View>
    );
  }
  if (compact) {
    return (
      <Card
        tone={tone}
        style={{
          flex: 1,
          padding: theme.spacing.sm,
          alignItems: 'center',
          gap: theme.spacing.xxs,
        }}
      >
        {icon && (
          <Icon
            name={icon}
            color={color ?? theme.tones[tone].foreground}
            size={theme.sizes.iconSmall}
          />
        )}
        <AppText
          variant="heading"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{
            color: color ?? theme.colors.text,
            textAlign: 'center',
            fontVariant: ['tabular-nums'],
          }}
        >
          {value ?? '—'}
        </AppText>
        <AppText variant="micro" tone="muted" style={{ textAlign: 'center' }}>
          {label}
          {unit ? ` · ${unit}` : ''}
        </AppText>
        {caption && (
          <AppText
            variant="micro"
            tone="muted"
            style={captionColor ? { color: captionColor } : undefined}
          >
            {caption}
          </AppText>
        )}
      </Card>
    );
  }
  return (
    <Card tone={tone} style={{ flex: 1 }}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText
        variant="metric"
        tone={value === null ? 'muted' : 'text'}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value ?? '—'}
      </AppText>
      {unit && (
        <AppText variant="micro" tone="muted">
          {unit}
        </AppText>
      )}
      {caption && (
        <AppText variant="caption" tone="muted">
          {caption}
        </AppText>
      )}
    </Card>
  );
}
