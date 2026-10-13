import { Card } from './Card';
import { Badge } from './Badge';
import { AppText } from './AppText';
import { AppButton } from './AppButton';
import { Stack } from './Stack';
import type { Tone } from '../theme/theme';

export function PlaceholderCard({
  eyebrow,
  title,
  description,
  action,
  tone = 'brand',
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: string;
  tone?: Tone;
}) {
  return (
    <Card tone={tone}>
      <Stack direction="row" align="center" justify="space-between" wrap>
        <AppText variant="eyebrow" tone="brand">
          {eyebrow}
        </AppText>
        <Badge label="Coming soon" />
      </Stack>
      <AppText variant="hero">{title}</AppText>
      <AppText tone="muted">{description}</AppText>
      {action && <AppButton title={action} disabled />}
    </Card>
  );
}
