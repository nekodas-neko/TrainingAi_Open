import type {
  ResourceSpec,
  ResourceState,
} from "../../workouts/data/WorkoutResources.ts";
import { achievementsSpec, type Rewards } from "./models.ts";
import { xpGained } from "./view.ts";

type Reader = {
  load(spec: ResourceSpec<Rewards>, manual?: boolean): Promise<void>;
  state(spec: ResourceSpec<Rewards>): ResourceState<Rewards>;
};

/**
 * The XP to measure a workout against, or null when the view is not a settled server answer: still
 * loading, revalidating, or showing saved data after a failed read. Without a baseline the summary
 * shows no XP rather than a gain measured from an old total (the current app's Q-126 rule).
 */
export function settledXp(state: ResourceState<Rewards>) {
  return state.data && !state.loading && !state.refreshing && !state.error
    ? state.data.xp
    : null;
}

/** XP a finished, uploaded workout earned: a fresh server total minus the baseline. */
export async function earnedXp(resources: Reader, before: number) {
  await resources.load(achievementsSpec, true);
  const state = resources.state(achievementsSpec);
  return state.error ? null : xpGained(before, state.data?.xp);
}
