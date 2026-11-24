import { useEffect, useState } from 'react';
import { AppButton, ConfirmationCard, Notice, Sheet, Stack } from '../../../shared/ui';

// The one place a start control says an activity is already open (#4099). Every start control on
// the Cardio Hub opens this instead of the chooser or a disabled button, so the person sees where
// they are why nothing new started, and can resume the activity or discard it.
export function InProgressSheet({
  visible,
  title,
  startConfirming = false,
  onClose,
  onDismiss,
  onResume,
  onDiscard,
}: {
  visible: boolean;
  /** What the open activity is called, e.g. "Treadmill". */
  title: string;
  /** Open on the discard confirmation (the Resume card's Discard). */
  startConfirming?: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  onResume: () => void;
  onDiscard: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(startConfirming);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setConfirming(startConfirming);
      setError(null);
    }
  }, [visible, startConfirming]);
  async function discard() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDiscard();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not discard the activity.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible={visible} title="Activity in progress" onClose={onClose} onDismiss={onDismiss}>
      {confirming ? (
        <ConfirmationCard
          title="Discard this activity?"
          message="It has not been saved. Discarding ends it without saving."
          danger
          confirmLabel="Discard"
          cancelLabel="Keep activity"
          busy={busy}
          onConfirm={() => void discard()}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <>
          <Notice
            title="An activity is in progress"
            message={`${title} is still open. Resume it, or discard it without saving to start something else.`}
          />
          <Stack>
            <AppButton title="Resume" onPress={onResume} />
            <AppButton title="Discard" variant="secondary" onPress={() => setConfirming(true)} />
          </Stack>
        </>
      )}
      {error && <Notice error title="Could not discard" message={error} />}
    </Sheet>
  );
}
