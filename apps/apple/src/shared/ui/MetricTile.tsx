import { Card } from './Card';
import { AppText } from './AppText';
import type { Tone } from '../theme/theme';
import { useTheme } from '../theme/ThemeProvider';

export function MetricTile({
  label,
  value,
  caption,
  unit,
  tone = 'brand',
  compact = false,
}: {
  label: string;
  value: string | null;
  caption?: string;
  unit?: string;
  tone?: Tone;
  compact?: boolean;
}) {
  const { theme } = useTheme();
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
        <AppText variant="heading" numberOfLines={1} adjustsFontSizeToFit>
          {value ?? '—'}
        </AppText>
        <AppText variant="micro" tone="muted">
          {label}
          {unit ? ` · ${unit}` : ''}
        </AppText>
        {caption && (
          <AppText variant="micro" tone="muted">
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
