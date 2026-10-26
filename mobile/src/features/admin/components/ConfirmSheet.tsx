import { AppButton, AppText, Sheet } from '../../../shared/ui';

/** The confirm every admin action that removes, locks out or elevates someone sits behind. */
export function ConfirmSheet({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
  danger = true,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  danger?: boolean;
}) {
  return (
    <Sheet visible title={title} onClose={onClose}>
      <AppText tone="muted">{message}</AppText>
      <AppButton
        title={confirmLabel}
        variant={danger ? 'danger' : 'primary'}
        onPress={() => {
          onClose();
          onConfirm();
        }}
      />
      <AppButton title="Cancel" variant="secondary" onPress={onClose} />
    </Sheet>
  );
}
