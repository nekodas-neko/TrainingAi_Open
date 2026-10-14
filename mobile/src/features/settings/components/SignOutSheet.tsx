import { plural } from '@trainingai/shared/format/plural';
import { AppButton, AppText, Sheet, StatusIndicator } from '../../../shared/ui';
import { useAccountContext } from '../../account/AccountProvider';
import { useNativeDataActions } from '../data/useNativeDataActions';
/** Every sign-out button opens this, so unsent changes are always shown first (#2532). */
export function SignOutSheet({ onClose }: { onClose: () => void }) {
  const account = useAccountContext(),
    actions = useNativeDataActions();
  return (
    <Sheet
      visible
      title="Sign out"
      onClose={onClose}
      actions={<StatusIndicator label="Saved changes" busy={actions.busy} error={actions.error} />}
    >
      <AppText>
        {actions.pending
          ? `${plural(actions.pending, 'change', 'changes')} ${actions.pending === 1 ? 'is' : 'are'} waiting to upload. They stay on this phone and can sync when you sign back into this account.`
          : 'Your saved account data stays on this phone.'}
      </AppText>
      {actions.pending > 0 && (
        <AppButton title="Sync now" busy={actions.busy} onPress={() => void actions.sync()} />
      )}
      <AppButton
        title="Sign out"
        disabled={actions.busy}
        onPress={() => {
          void account.signOut();
          onClose();
        }}
      />
    </Sheet>
  );
}
