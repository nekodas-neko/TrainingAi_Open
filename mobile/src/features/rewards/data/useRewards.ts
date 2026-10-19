import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorage } from "../../../core/storage/StorageProvider";
import { useAccountContext } from "../../account/AccountProvider";
import {
  useWorkoutResource,
  useWorkoutResources,
} from "../../workouts/data/WorkoutDataProvider";
import { achievementsSpec } from "./models";
import { markSeen, readSeen } from "./seen";
import { earnedXp, settledXp } from "./xp";

/** The signed-in account's XP, level and achievements, as the server last calculated them. */
export function useRewards() {
  return useWorkoutResource(achievementsSpec);
}

/** Achievement ids this account has been shown as unlocked; null until read from the phone. */
export function useSeenAchievements() {
  const storage = useLocalStorage();
  const connection = useAccountContext().dataReader;
  const scoped = useMemo(
    () =>
      connection ? storage.account(connection.origin, connection.userId) : null,
    [storage, connection],
  );
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

/**
 * XP a workout earned, for its summary. The baseline is the server's total, read once while the
 * workout is active; the gain is the server's total after the workout has uploaded, minus that.
 * Preview adds up nothing itself. A workout opened from history, or one started offline, has no
 * baseline and shows no XP.
 */
export function useWorkoutXp(
  workout: { id: string; status: string; pending: unknown[] } | undefined,
) {
  const resources = useWorkoutResources();
  const id = workout?.id;
  const active = workout?.status === "active";
  const [baseline, setBaseline] = useState<{ id: string; xp: number } | null>(
    null,
  );
  const [earned, setEarned] = useState<{
    id: string;
    xp: number | null;
  } | null>(null);
  const requested = useRef<string | null>(null);
  const state = useWorkoutResource(
    achievementsSpec,
    active || (!!id && baseline?.id === id),
  );
  const known = settledXp(state);
  useEffect(() => {
    if (active && id && known !== null && baseline?.id !== id)
      setBaseline({ id, xp: known });
  }, [active, id, known, baseline?.id]);
  const uploaded =
    workout?.status === "completed" && workout.pending.length === 0;
  useEffect(() => {
    if (
      !resources ||
      !id ||
      !uploaded ||
      baseline?.id !== id ||
      requested.current === id
    )
      return;
    requested.current = id;
    void earnedXp(resources, baseline.xp)
      .catch(() => null)
      .then((xp) => setEarned({ id, xp }));
  }, [resources, id, uploaded, baseline]);
  return earned && earned.id === id ? earned.xp : null;
}
