import { useState } from 'react';
import { AppButton, AppText, Sheet, TextField } from '../../../shared/ui';
import { emailMatches } from '../data/admin-users';

/** The confirm every admin action that removes, locks out or elevates someone sits behind. */
export function ConfirmSheet({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
  danger = true,
  confirmEmail,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: (typed: string) => void;
  onClose: () => void;
  danger?: boolean;
  /** Asks the admin to type this email; the confirm stays disabled until it matches. */
  confirmEmail?: string;
  /** Receives what was typed, so the server can check it too. */
}) {
  const [typed, setTyped] = useState('');
  const locked = confirmEmail !== undefined && !emailMatches(typed, confirmEmail);
  return (
    <Sheet visible title={title} onClose={onClose}>
      <AppText tone="muted">{message}</AppText>
      {confirmEmail !== undefined && (
        <TextField
          label={`Type their email, ${confirmEmail}, to confirm`}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
      )}
      <AppButton
        title={confirmLabel}
        variant={danger ? 'danger' : 'primary'}
        disabled={locked}
        onPress={() => {
          onClose();
          onConfirm(typed);
        }}
      />
      <AppButton title="Cancel" variant="secondary" onPress={onClose} />
    </Sheet>
  );
}
