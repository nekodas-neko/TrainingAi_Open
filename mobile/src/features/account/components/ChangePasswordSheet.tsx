import { useState } from 'react';
import { AppButton, AppText, Sheet, StatusIndicator, TextField } from '../../../shared/ui';
import { useAccountContext } from '../AccountProvider';
import {
  PASSWORD_CHANGED,
  PASSWORD_PATH,
  emptyPasswordForm,
  passwordBody,
  passwordFailure,
  passwordFormProblem,
  type PasswordForm,
} from '../data/change-password';

/** Change password (#3882): the current app's Account → Change password, on the same server route. */
export function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const account = useAccountContext();
  const [form, setForm] = useState<PasswordForm>(emptyPasswordForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const problem = passwordFormProblem(form);
  const patch = account.dataReader?.patch;
  async function save() {
    if (busy || problem || !patch) return;
    setBusy(true);
    setError(null);
    try {
      await patch(PASSWORD_PATH, passwordBody(form));
      setDone(true);
    } catch (failure) {
      setError(passwordFailure(failure));
    } finally {
      // The fields never outlive the answer, whichever it was.
      setForm(emptyPasswordForm);
      setBusy(false);
    }
  }
  const field = (key: keyof PasswordForm, label: string, autoComplete: 'current-password' | 'new-password') => (
    <TextField
      label={label}
      value={form[key]}
      secureTextEntry
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete={autoComplete}
      editable={!busy}
      onChangeText={(value) => setForm((old) => ({ ...old, [key]: value }))}
    />
  );
  return (
    <Sheet
      visible
      title="Change password"
      onClose={() => {
        if (!busy) onClose();
      }}
      actions={<StatusIndicator label="Password change" busy={busy} error={error} />}
      footer={
        done ? (
          <AppButton title="Done" onPress={onClose} />
        ) : (
          <AppButton
            title="Change password"
            busy={busy}
            disabled={!!problem || !patch}
            onPress={() => void save()}
          />
        )
      }
    >
      {done ? (
        <AppText>{PASSWORD_CHANGED}</AppText>
      ) : (
        <>
          {field('current', 'Current password', 'current-password')}
          {field('next', 'New password', 'new-password')}
          {field('confirm', 'Confirm new password', 'new-password')}
          {problem && form.next.length > 0 && (
            <AppText variant="caption" tone="muted">
              {problem}
            </AppText>
          )}
        </>
      )}
    </Sheet>
  );
}
