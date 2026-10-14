import { useState } from 'react';
import { deviceHealthName } from '../../../integrations/device-health/platform';
import { ACCOUNT_DELETION_PHRASE } from '@trainingai/shared/user/account-deletion';
import {
  AppButton,
  AppText,
  Card,
  Sheet,
  StatusIndicator,
  TextField,
} from '../../../shared/ui';
import { useAccountContext } from '../../account/AccountProvider';
import { useNativeDataActions } from '../data/useNativeDataActions';
export function DeleteAccountSheet({ onClose }: { onClose: () => void }) {
  const account = useAccountContext(),
    actions = useNativeDataActions();
  const [typed, setTyped] = useState(''),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function remove() {
    if (typed !== ACCOUNT_DELETION_PHRASE || !account.dataReader?.delete || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!checked) {
        await actions.sync();
        setChecked(true);
        return;
      }
      await account.dataReader.delete('/api/account', { confirm: typed });
      await actions.clearAccount();
      await account.signOut();
      onClose();
    } catch {
      setError('Could not finish deleting your account. Retry when connected.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      visible
      title="Delete account"
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      actions={<StatusIndicator label="Account deletion" busy={busy} error={error} />}
      footer={
        <AppButton
          title={
            !checked ? 'Sync and review' : actions.pending ? 'Delete anyway' : 'Delete account'
          }
          variant="danger"
          busy={busy || actions.busy}
          disabled={typed !== ACCOUNT_DELETION_PHRASE || !account.dataReader}
          onPress={() => void remove()}
        />
      }
    >
      <AppText>
        This permanently removes your account and its server records: profile, workouts,
        programs, nutrition and health history. This cannot be undone.
      </AppText>
      <AppText variant="caption" tone="muted">
        Your original {deviceHealthName} records are not deleted.
      </AppText>
      {checked && actions.pending > 0 && (
        <Card tone="heart">
          <AppText>
            {actions.pending} changes are still saved only on this phone. Deleting the account
            will remove them too.
          </AppText>
        </Card>
      )}
      <TextField
        label={`Type ${ACCOUNT_DELETION_PHRASE} to confirm`}
        value={typed}
        autoCapitalize="characters"
        onChangeText={setTyped}
      />
    </Sheet>
  );
}
