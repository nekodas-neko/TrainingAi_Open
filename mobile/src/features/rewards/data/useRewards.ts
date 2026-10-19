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
import { readTrophyCase, writeTrophyCase } from './trophy';
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

/** The achievements pinned in this account's trophy case on this phone; null until read. */
export function useTrophyCase() {
  const scoped = useAccountStorage();
  const [pinned, setPinned] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    setPinned(null);
    if (scoped) {
      void readTrophyCase(scoped).then((ids) => live && setPinned(ids));
    }
    return () => {
      live = false;
    };
  }, [scoped]);
  const change = useCallback(
    (next: (pinned: readonly string[]) => string[]) => {
      if (!scoped || !pinned) return;
      const value = next(pinned);
      setPinned(value);
      void writeTrophyCase(scoped, value).catch(() => {});
    },
    [scoped, pinned],
  );
  return {
    pinned,
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
