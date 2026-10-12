import { Card } from './Card';
import { AppText } from './AppText';
import type { Tone } from '../theme/theme';

export function MetricTile({
  label,
  value,
  caption,
  unit,
  tone = 'brand',
}: {
  label: string;
  value: string | null;
  caption?: string;
  unit?: string;
  tone?: Tone;
}) {
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
