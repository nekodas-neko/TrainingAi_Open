import { useEffect, useSyncExternalStore } from 'react';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { friendMealLibraries, idleFriendMeals } from './FriendMealLibraries';

const noSubscribe = () => () => {};
/**
 * A friend's meal library, read from the server and held in memory (#2218). `friendshipId` is the
 * friendship's id, not the friend's user id; null (not known yet) reads as idle and loads nothing.
 */
export function useFriendMeals(friendshipId: string | null) {
  const resources = useWorkoutResources();
  const libraries = resources ? friendMealLibraries(resources) : null;
  const state = useSyncExternalStore(
    libraries?.subscribe ?? noSubscribe,
    () => (libraries && friendshipId ? libraries.state(friendshipId) : idleFriendMeals),
    () => idleFriendMeals,
  );
  useEffect(() => {
    if (libraries && friendshipId) {
      void libraries.load(friendshipId);
    }
  }, [libraries, friendshipId]);
  return {
    ...state,
    refresh: () => (libraries && friendshipId ? libraries.load(friendshipId, true) : undefined),
  };
}
