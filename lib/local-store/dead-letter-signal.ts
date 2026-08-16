// K3: surface dead-lettered outbox mutations at quarantine time instead of only
// on a card the user must navigate to. Two surfaces:
//   - a reactive failed-count → a persistent dot on the More tab (all domains);
//   - a one-time toast when a Tier-A write (a workout) dead-letters while the app
//     is open, since a lost workout is the app's worst-case data loss.
// Lower-stakes domains (food, supplements, mood, checkins, injuries) get the badge
// only — no toast — so red is reserved for things worth interrupting for.
import { getLocalStore } from './index';
import type { SyncedMutationDomain } from '@trainingai/shared/sync/mutation-schema';

const TIER_A: ReadonlySet<SyncedMutationDomain> = new Set([
  'workout_log', 'complete_workout', 'session_rpe', 'fitness_tests',
]);

const NOTIFIED_KEY = 'ta_deadletter_notified_v1';

let _count = 0;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }

export function getDeadLetterCount(): number { return _count; }

export function subscribeDeadLetterCount(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setDeadLetterCount(n: number): void {
  if (n === _count) return;
  _count = n;
  emit();
}

function loadNotified(): Set<string> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(NOTIFIED_KEY) : null;
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}

function saveNotified(ids: Set<string>): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...ids]));
  } catch { /* best-effort */ }
}

// Reads the current failed set, drives the badge count, and fires one toast per
// newly dead-lettered Tier-A mutation (tracked in localStorage so a reload doesn't
// re-nag). Best-effort and idempotent — safe to call after every push and on mount.
export async function reconcileDeadLetters(userId: string): Promise<void> {
  const store = getLocalStore(userId);
  if (!store) return;
  let failed;
  try { failed = await store.getFailedMutations(userId); } catch { return; }

  setDeadLetterCount(failed.length);

  const notified = loadNotified();
  const failedTierAIds = failed.filter(m => TIER_A.has(m.domain)).map(m => m.id);
  const fresh = failedTierAIds.filter(id => !notified.has(id));

  if (fresh.length > 0) {
    // Dynamic import keeps sonner out of this data-layer module's static graph.
    try {
      const { toast } = await import('sonner');
      toast.error(
        fresh.length === 1
          ? "A workout didn't sync — review in More"
          : `${fresh.length} workouts didn't sync — review in More`,
      );
    } catch { /* toast unavailable — the badge still surfaces it */ }
  }

  // Keep the notified set to just the currently-failed Tier-A ids: a retried/
  // discarded row leaves the set so a genuine future re-failure can re-notify.
  saveNotified(new Set(failedTierAIds));
}
