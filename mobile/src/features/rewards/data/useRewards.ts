import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pinTrophy, unpinTrophy } from '@trainingai/shared/achievement-display';
import { useLocalStorage } from '../../../core/storage/StorageProvider';
import { useAccountContext } from '../../account/AccountProvider';
import {
  useWorkoutResource,
  useWorkoutResources,
} from '../../workouts/data/WorkoutDataProvider';
import { achievementsSpec } from './models';
import { equipTitle } from './titles';
import { markSeen, readSeen } from './seen';
import {
  cachedTrophyCase,
  carryOverTrophyCase,
  readFreshTrophyPins,
  rememberTrophyCase,
  saveTrophyPins,
  trophyCacheKey,
  trophyPinsSpec,
} from './trophy';
import { WorkoutXpTracker } from './xp';

/** The signed-in account's XP, level and achievements, as the server last calculated them. */
export function useRewards() {
  return useWorkoutResource(achievementsSpec);
}

function useAccountStorage() {
  const storage = useLocalStorage();
  const connection = useAccountContext().dataReader;
  return useMemo(
    () => (connection ? storage.account(connection.origin, connection.userId) : null),
    [storage, connection],
  );
}

/** Achievement ids this account has been shown as unlocked; null until read from the phone. */
export function useSeenAchievements() {
  const scoped = useAccountStorage();
  const [seen, setSeen] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    setSeen(null);
    if (scoped) {
      void readSeen(scoped).then((ids) => live && setSeen(ids));
    }
    return () => {
      live = false;
    };
  }, [scoped]);
  const mark = useCallback(
    async (ids: string[]) => {
      if (scoped && seen) {
        setSeen(await markSeen(scoped, seen, ids).catch(() => seen));
      }
    },
    [scoped, seen],
  );
  return { seen, mark };
}

/** The achievements pinned in this account's trophy case, which friends see too; null until first read. */
export function useTrophyCase(unlockedIds: readonly string[]) {
  const scoped = useAccountStorage();
  const connection = useAccountContext().dataReader;
  const { data, resources } = useWorkoutResource(trophyPinsSpec);
  const key = connection ? trophyCacheKey(connection.origin, connection.userId) : null;
  const [settled, setSettled] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // A string, so the carry-over effect re-runs when the set changes and not on every render.
  const unlockedKey = unlockedIds.join(',');
  const account = data ? (data.pins ?? []) : null;
  useEffect(() => {
    setSettled(false);
  }, [key]);
  // The carry-over waits for the server's own answer: `data` may be the copy this phone saved, older
  // than a change made on another device. A failed read leaves the old list for the next load.
  useEffect(() => {
    let live = true;
    if (key && resources && scoped && data && connection) {
      void readFreshTrophyPins(connection)
        .then((fresh) =>
          carryOverTrophyCase(
            resources,
            scoped,
            new Set(unlockedKey.split(',').filter(Boolean)),
            fresh,
          ),
        )
        .catch(() => {})
        .then(() => live && setSettled(true));
    }
    return () => {
      live = false;
    };
    // Once per account: a later edit changes `data`, and the old list is gone by then.
  }, [key, resources, scoped, data !== null, unlockedKey]);
  const pinned = settled ? account : key ? (cachedTrophyCase(key) ?? null) : null;
  useEffect(() => {
    if (key && settled && account) {
      rememberTrophyCase(key, account);
    }
  }, [key, settled, data]);
  const change = useCallback(
    (next: (pinned: readonly string[]) => string[]) => {
      if (!resources || !pinned) return;
      setSaveFailed(false);
      void saveTrophyPins(resources, next(pinned)).then((saved) => setSaveFailed(saved !== 'saved'));
    },
    [resources, pinned],
  );
  return {
    pinned,
    /** The last save did not reach the account, so the view went back to what it held. */
    saveFailed,
    pin: (id: string) => change((now) => pinTrophy(now, id)),
    unpin: (id: string) => change((now) => unpinTrophy(now, id)),
  };
}

/** Equip a title, or clear it with null. The server checks the player has earned it. */
export function useEquipTitle() {
  const resources = useWorkoutResources();
  return useCallback(
    (titleId: string | null) =>
      resources ? equipTitle(resources, titleId) : Promise.resolve(false),
    [resources],
  );
}

/**
 * XP a workout earned, for its summary (see `WorkoutXpTracker`). The start total is read when the
 * workout is active, the gain once it has uploaded. Reads go through the resource directly, never
 * `useWorkoutResource`, so this screen cannot turn the view More shares into a local-only one.
 */
export function useWorkoutXp(
  workout: { id: string; status: string; pending: unknown[] } | undefined,
) {
  const resources = useWorkoutResources();
  const tracker = useMemo(
    () => (resources ? new WorkoutXpTracker(resources) : null),
    [resources],
  );
  const [earned, setEarned] = useState<{ id: string; xp: number | null } | null>(null);
  const requested = useRef<string | null>(null);
  const id = workout?.id;
  const active = workout?.status === 'active';
  const uploaded = workout?.status === 'completed' && workout.pending.length === 0;
  useEffect(() => {
    if (tracker && id && active) void tracker.start(id);
  }, [tracker, id, active]);
  useEffect(() => {
    if (!tracker || !id || !uploaded || requested.current === id) return;
    requested.current = id;
    void tracker
      .earned(id)
      .catch(() => null)
      .then((xp) => setEarned({ id, xp }));
  }, [tracker, id, uploaded]);
  return earned && earned.id === id ? earned.xp : null;
}
