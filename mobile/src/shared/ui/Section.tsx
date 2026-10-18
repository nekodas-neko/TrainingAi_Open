import type { PropsWithChildren } from 'react';
import { Card } from './Card';
import { AppText } from './AppText';
import { Stack } from './Stack';
import type { Tone } from '../theme/theme';

export function Section({
  title,
  tone = 'neutral',
  children,
}: PropsWithChildren<{ title: string; tone?: Tone }>) {
  return (
    <Stack gap="md">
      <AppText variant="eyebrow" tone="muted" accessibilityRole="header">
        {title}
      </AppText>
      <Card padded={false} tone={tone}>
        {children}
      </Card>
    </Stack>
  );
}
