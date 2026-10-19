import type {
  ResourceSpec,
  ResourceState,
} from '../../workouts/data/WorkoutResources.ts';
import { achievementsSpec, type Rewards } from './models.ts';
import { xpGained } from './view.ts';

type Reader = {
  load(spec: ResourceSpec<Rewards>, manual?: boolean): Promise<void>;
  state(spec: ResourceSpec<Rewards>): ResourceState<Rewards>;
};

/**
 * The server's XP total right now, from a forced read; null when that read failed. A saved copy,
 * or a background reload still in flight, is never taken for it: the old total would credit an
 * unlock from before the workout to the workout.
 */
export async function freshXp(resources: Reader) {
  await resources.load(achievementsSpec, true);
  const state = resources.state(achievementsSpec);
  return state.error ? null : (state.data?.xp ?? null);
}

/**
 * XP a workout earned: the server's total after it uploaded, minus the total read when it began.
 * Preview adds up nothing itself. A workout that began offline, or was opened from history, has no
 * start total and earns nothing here, so the summary shows no XP rather than a wrong figure (the
 * current app's Q-126 rule).
 */
export class WorkoutXpTracker {
  private starts = new Map<string, Promise<number | null>>();
  constructor(private resources: Reader) {}
  /** Read the starting total, once per workout. */
  start(id: string) {
    if (!this.starts.has(id))
      this.starts.set(
        id,
        freshXp(this.resources).catch(() => null),
      );
    return this.starts.get(id)!;
  }
  /** The gain once the workout has uploaded; null when there is no start total or no fresh read. */
  async earned(id: string) {
    const before = await this.starts.get(id);
    if (before == null) return null;
    return xpGained(before, await freshXp(this.resources).catch(() => null));
  }
}
