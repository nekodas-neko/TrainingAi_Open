'use client';

import { useCallback, useEffect, useState } from 'react';
import { useGuardedAction } from '@/lib/hooks/use-guarded-action';
import { getLocalStore } from '@/lib/local-store';
import { pushMutations } from '@/lib/local-store/sync-engine';
import { setDeadLetterCount } from '@/lib/local-store/dead-letter-signal';
import type { PendingMutation } from '@/lib/local-store/types';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useRefreshOnTabShow } from "@/components/shell/tab-visibility";

/** Sentinel for `busyId` while the batch retry runs, so every button on the card disables. */
const RETRY_ALL = '__all__';

const DOMAIN_LABELS: Record<PendingMutation['domain'], string> = {
  body_metrics:    'Body metrics',
  mood_logs:       'Mood check-in',
  food_logs:       'Food log',
  food_items:      'Food item',
  supplement_logs: 'Supplement log',
  injuries:        'Injury',
  supplements:     'Supplement',
  activity_logs:   'Activity',
  fitness_tests:   'Fitness test',
  prescribed_run:  'Prescribed run',
  workout_log:     'Workout',
  day_checkins:    'Day check-in',
  session_rpe:     'Session RPE',
  complete_workout: 'Workout completion',
  saved_meals:     'Saved meal',
  oura_daily_summary: 'Ring daily summary',
  oura_daily_derived: 'Ring derived scores',
  sleep_session:      'Sleep session',
  plan_meal_answers:  'Planned meal answer',
  manual_bedtime:     'Bedtime you entered',
  rest_days:          'Rest day you chose',
};

export function SyncHealthCard({ userId }: { userId?: string }) {
  const [failed, setFailed] = useState<PendingMutation[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const store = userId ? getLocalStore(userId) : null;
    if (!store) return;
    const [failedRows, pendingRows] = await Promise.all([
      store.getFailedMutations(userId!),
      store.getPendingMutations(userId!),
    ]);
    setFailed(failedRows);
    setPendingCount(pendingRows.length);
    // Keep the More-tab badge in sync when the user retries/discards here (K3).
    setDeadLetterCount(failedRows.length);
  }, [userId]);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);
  // Outbox rows are written from every other tab, so this is the card most likely to be wrong
  // after the tab has been sitting mounted in the background.
  useRefreshOnTabShow(() => { refresh().catch(() => {}); });

  const handleRetry = useCallback(async (id: string) => {
    const store = userId ? getLocalStore(userId) : null;
    if (!store) return;
    setBusyId(id);
    try {
      await store.retryFailedMutation(id);
      await pushMutations(userId!);
      await refresh();
      const stillFailed = (await store.getFailedMutations(userId!)).some(m => m.id === id);
      if (stillFailed) toast.error('Still failing — see the error below');
      else toast.success('Synced');
    } finally {
      setBusyId(null);
    }
  }, [userId, refresh]);

  // RV-122. The entry asked for the `/more/data` "Sync now" button to be promoted onto this card,
  // on the reading that it is what clears these. It is not: that button calls `pullDelta`, which
  // never pushes. Even a push is not enough on its own — a dead-lettered row stays dead until
  // `retryFailedMutation` resets it — so the per-item Retry was genuinely the only thing that could
  // clear this card, which is the complaint. This is that, for all of them, in one tap.
  //
  // One `pushMutations` for the whole batch, not one per row: N taps of Retry sends N pushes.
  const handleRetryAll = useGuardedAction(async () => {
    const store = userId ? getLocalStore(userId) : null;
    if (!store) return;
    setBusyId(RETRY_ALL);
    try {
      const rows = await store.getFailedMutations(userId!);
      for (const m of rows) await store.retryFailedMutation(m.id);
      await pushMutations(userId!);
      await refresh();
      const stillFailed = await store.getFailedMutations(userId!);
      if (stillFailed.length === 0) toast.success('Synced');
      else if (stillFailed.length < rows.length) {
        toast.warning(`${rows.length - stillFailed.length} synced, ${stillFailed.length} still failing`);
      } else toast.error('Still failing — see the errors below');
    } finally {
      setBusyId(null);
    }
  }, () => { setBusyId(null); toast.error('Retry failed'); });

  const handleDiscard = useCallback(async (id: string) => {
    const store = userId ? getLocalStore(userId) : null;
    if (!store) return;
    await store.deleteMutations([id]);
    await refresh();
    toast('Change discarded');
  }, [userId, refresh]);

  if (failed.length === 0 && pendingCount === 0) return null;

  if (failed.length === 0) {
    // Outbox has pending mutations but none have failed — a low-key, non-alarming
    // depth indicator (item 13: "sync freshness / outbox depth" surfacing).
    return (
      <div className="mx-4 mt-3 rounded-xl border border-border bg-muted/40 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {pendingCount} change{pendingCount > 1 ? 's' : ''} syncing…
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
        {failed.length} change{failed.length > 1 ? 's' : ''} failed to sync
        {pendingCount > 0 && (
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {pendingCount} waiting
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-2">
        {failed.map(m => (
          <li key={m.id} className="rounded-lg bg-background/60 p-2">
            <div className="text-xs font-medium">
              {DOMAIN_LABELS[m.domain]} — {m.date}
            </div>
            <div className="mt-0.5 line-clamp-2 break-all text-[11px] text-muted-foreground">
              {m.lastError ?? 'Unknown error'} ({m.attempts} attempts)
            </div>
            <div className="mt-1.5 flex gap-2">
              <Button size="sm" variant="secondary" className="h-8 flex-1"
                      disabled={busyId !== null} onClick={() => handleRetry(m.id)}>
                Retry
              </Button>
              <Button size="sm" variant="ghost" className="h-8 flex-1 text-destructive"
                      disabled={busyId !== null} onClick={() => handleDiscard(m.id)}>
                Discard
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {failed.length > 1 && (
        <Button size="sm" className="mt-2 h-9 w-full" disabled={busyId !== null}
                onClick={() => void handleRetryAll()}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busyId === RETRY_ALL ? 'animate-spin' : ''}`} aria-hidden />
          Retry all {failed.length}
        </Button>
      )}
    </div>
  );
}
