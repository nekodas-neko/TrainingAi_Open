import { Card } from './Card';
import { AppText } from './AppText';

export function Notice({
  title,
  message,
  error = false,
}: {
  title: string;
  message: string;
  error?: boolean;
}) {
  return (
    <Card accessibilityRole={error ? 'alert' : undefined} tone={error ? 'heart' : 'neutral'}>
      <AppText variant="label" tone={error ? 'danger' : 'text'}>
        {title}
      </AppText>
      <AppText variant="caption" tone="muted">
        {message}
      </AppText>
    </Card>
  );
}
