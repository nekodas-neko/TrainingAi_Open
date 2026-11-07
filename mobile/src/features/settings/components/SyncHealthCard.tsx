import { useState } from 'react';
import { AppButton, AppText, Card, ConfirmationCard, Stack } from '../../../shared/ui';
import { useActivities } from '../../activities/data/ActivityProvider';
import {
  activityRetryState,
  failedHeading,
  isActivityList,
  itemDetail,
  itemTitle,
  retryNotice,
  type FailedItem,
} from '../../activities/data/sync-health';
import type { SetAsideQueue } from '../../../core/sync/set-aside';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { useHistoryQueue } from '../../workouts/data/HistoryQueueProvider';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import { useTrainingSync } from '../../workouts/data/WorkoutDataProvider';
// Every Preview outbox that sets a refused change aside (`core/sync/set-aside.ts`, #3638), as one
// list. Each hook re-renders this card when its queue changes.
function useSetAsideQueues(): SetAsideQueue[] {
  const activities = useActivities(),
    nutrition = useNutrition(),
    history = useHistoryQueue(),
    journal = useWorkoutJournal(),
    training = useTrainingSync();
  const queues: SetAsideQueue[] = [];
  const activityStore = activities.store;
  if (activityStore) {
    queues.push({
      failed: activities.failed,
      retry: (item) =>
        isActivityList(item.list) ? activityStore.retryRejected(item.list, item.id) : Promise.resolve(),
      discard: (item) =>
        isActivityList(item.list)
          ? activityStore.discardRejected(item.list, item.id)
          : Promise.resolve(),
      state: (item) => activityRetryState(activityStore.getSnapshot(), item),
    });
  }
  for (const store of [nutrition.store, history.queue, journal.controller, training.store]) {
    if (store) {
      queues.push({
        failed: store.failed(),
        retry: (item) => store.retryRejected(item.id),
        discard: (item) => store.discardRejected(item.id),
        state: (item) => store.retryState(item.id),
      });
    }
  }
  return queues;
}
// The current app's More → Sync health card (`components/more/sync-health-card.tsx`), for every
// change Preview has set aside: activities, nutrition, workouts, history edits, programs and
// injuries. The current app discards without asking; Preview asks first, as #3130 specified.
export function SyncHealthCard() {
  const queues = useSetAsideQueues(),
    [busy, setBusy] = useState(false),
    [discarding, setDiscarding] = useState<FailedItem | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const failed = queues.flatMap((queue) => queue.failed);
  const queueOf = (item: FailedItem) =>
    queues.find((queue) =>
      queue.failed.some((entry) => entry.list === item.list && entry.id === item.id),
    );
  if (failed.length === 0 && !notice) {
    return null;
  }
  async function retry(items: FailedItem[]) {
    if (busy) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const retried = items.flatMap((item) => {
        const queue = queueOf(item);
        return queue ? [{ item, queue }] : [];
      });
      for (const { item, queue } of retried) {
        await queue.retry(item);
      }
      setNotice(retryNotice(retried.map(({ item, queue }) => queue.state(item))));
    } catch {
      setNotice('Retry failed');
    } finally {
      setBusy(false);
    }
  }
  async function discard(item: FailedItem) {
    setDiscarding(null);
    const queue = queueOf(item);
    if (!queue) {
      return;
    }
    setBusy(true);
    try {
      await queue.discard(item);
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
