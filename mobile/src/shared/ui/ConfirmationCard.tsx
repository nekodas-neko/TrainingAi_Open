import { AppButton } from './AppButton';
import { AppText } from './AppText';
import { Card } from './Card';
import { Stack } from './Stack';

export function ConfirmationCard({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Keep training',
  onConfirm,
  onCancel,
  busy = false,
  danger = false,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <Card tone={danger ? 'heart' : 'brand'} accessibilityRole="alert">
      <AppText variant="heading">{title}</AppText>
      <AppText tone="muted">{message}</AppText>
      <Stack>
        <AppButton
          title={confirmLabel}
          variant={danger ? 'danger' : 'primary'}
          busy={busy}
          onPress={onConfirm}
        />
        <AppButton title={cancelLabel} variant="secondary" disabled={busy} onPress={onCancel} />
      </Stack>
    </Card>
  );
}
