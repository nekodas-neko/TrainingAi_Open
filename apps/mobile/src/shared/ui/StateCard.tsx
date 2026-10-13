import { AppButton } from './AppButton';
import { AppText } from './AppText';
import { Card } from './Card';
import { LoadingIndicator } from './LoadingIndicator';

export function StateCard({
  title,
  message,
  loading = false,
  error = false,
  action,
  onAction,
}: {
  title: string;
  message: string;
  loading?: boolean;
  error?: boolean;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <Card tone={error ? 'heart' : 'neutral'} accessibilityRole={error ? 'alert' : undefined}>
      {loading && <LoadingIndicator accessibilityLabel={title} />}
      <AppText variant="heading">{title}</AppText>
      <AppText tone="muted">{message}</AppText>
      {action && <AppButton title={action} onPress={onAction} busy={loading} />}
    </Card>
  );
}
