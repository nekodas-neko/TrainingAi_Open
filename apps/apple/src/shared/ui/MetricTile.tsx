import { Card } from './Card';
import { AppText } from './AppText';
import type { Tone } from '../theme/theme';

export function MetricTile({
  label,
  value,
  caption,
  tone = 'brand',
}: {
  label: string;
  value: string | null;
  caption?: string;
  tone?: Tone;
}) {
  return (
    <Card tone={tone} style={{ flex: 1 }}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText variant="metric" tone={value === null ? 'muted' : 'text'}>
        {value ?? '—'}
      </AppText>
      {caption && (
        <AppText variant="caption" tone="muted">
          {caption}
        </AppText>
      )}
    </Card>
  );
}
