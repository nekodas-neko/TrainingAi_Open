import { useState } from 'react';
import { AppButton, AppText, Card, ConfirmationCard, Stack } from '../../../shared/ui';
import { useActivities } from '../../activities/data/ActivityProvider';
import {
  failedHeading,
  itemDetail,
  itemTitle,
  retryNotice,
  type FailedItem,
} from '../../activities/data/sync-health';
// The current app's More → Sync health card (`components/more/sync-health-card.tsx`), for the
// queues Preview dead-letters: activities, fitness tests and run completions. The current app
// discards without asking; Preview asks first, as the task for #3130 specified.
export function SyncHealthCard() {
  const activities = useActivities(),
    [busy, setBusy] = useState(false),
    [discarding, setDiscarding] = useState<FailedItem | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const store = activities.store,
    failed = activities.failed;
  if (failed.length === 0 && !notice) {
    return null;
  }
  async function retry(items: FailedItem[]) {
    if (!store || busy) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      for (const item of items) {
        await store.retryRejected(item.list, item.id);
      }
      setNotice(retryNotice(items, store.getSnapshot()));
    } catch {
      setNotice('Retry failed');
    } finally {
      setBusy(false);
    }
  }
  async function discard(item: FailedItem) {
    setDiscarding(null);
    if (!store) {
      return;
    }
    setBusy(true);
    try {
      await store.discardRejected(item.list, item.id);
      setNotice('Change discarded');
    } catch {
      setNotice('Could not discard that change');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Card tone={failed.length ? 'heart' : 'neutral'}>
        {failed.length > 0 && (
          <>
            <AppText variant="subheading">{failedHeading(failed.length)}</AppText>
            {failed.map((item) => (
              <Stack key={`${item.list}:${item.id}`}>
                <AppText variant="caption">{itemTitle(item)}</AppText>
                <AppText variant="caption" tone="muted" numberOfLines={2}>
                  {itemDetail(item)}
                </AppText>
                <Stack direction="row">
                  <AppButton
                    title="Retry"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => void retry([item])}
                  />
                  <AppButton
                    title="Discard"
                    variant="danger"
                    disabled={busy}
                    onPress={() => setDiscarding(item)}
                  />
                </Stack>
              </Stack>
            ))}
            {failed.length > 1 && (
              <AppButton
                title={`Retry all ${failed.length}`}
                busy={busy}
                onPress={() => void retry(failed)}
              />
            )}
          </>
        )}
        {notice && (
          <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">
            {notice}
          </AppText>
        )}
      </Card>
      {discarding && (
        <ConfirmationCard
          danger
          title="Discard this change?"
          message="It is removed from this phone's upload queue and will not be sent. Anything already on the server is left as it is."
          confirmLabel="Discard"
          cancelLabel="Keep it"
          onConfirm={() => void discard(discarding)}
          onCancel={() => setDiscarding(null)}
        />
      )}
    </>
  );
}
