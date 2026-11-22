import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useWorkoutResources } from '../workouts/data/WorkoutDataProvider';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import { useNutrition } from '../nutrition/data/NutritionProvider';
import { useHome } from '../home/data/HomeProvider';
import { CoachConversation, type CoachOpenRequest } from './data/CoachConversation';
import { CoachActions } from './data/CoachActions';
import { scopes, type CoachScope } from './data/models';
import { todayInTz } from '@trainingai/shared/date-utils';

export type Coach = {
  conversations: Record<CoachScope, CoachConversation>;
  actions: CoachActions;
};
const Context = createContext<Coach | null>(null);
type Launch = {
  /** Opens the Coach, about a lift, session or workout when the request names one (#3896 steps 6-7). */
  launch: (request?: CoachOpenRequest, scope?: CoachScope) => void;
  /** The app shell's way to show the Coach screen. */
  navigator: { current: ((scope: CoachScope) => void) | null };
};
const LaunchContext = createContext<Launch>({
  launch: () => {},
  navigator: { current: null },
});
export function CoachProvider({ children }: PropsWithChildren) {
  const resources = useWorkoutResources(),
    workouts = useWorkoutContext(),
    nutrition = useNutrition(),
    home = useHome();
  const coach = useMemo(
    () =>
      resources
        ? {
            conversations: Object.fromEntries(
              scopes.map((scope) => [
                scope,
                new CoachConversation(resources, scope, randomUUID),
              ]),
            ) as Coach['conversations'],
            actions: new CoachActions(
              resources,
              () => {
                const today = todayInTz(
                  resources.connection.timezone ??
                    Intl.DateTimeFormat().resolvedOptions().timeZone,
                );
                workouts.invalidate();
                void nutrition.store?.refresh('targets', today, true);
                void home.store?.refresh('preferences', today, true);
              },
              (domain) =>
                domain === 'nutrition_targets' &&
                !!nutrition.store
                  ?.getSnapshot()
                  .http.some((operation) => operation.kind === 'targets'),
            ),
          }
        : null,
    [resources, workouts.invalidate, nutrition.store, home.store],
  );
  useEffect(() => {
    if (!coach) return;
    const conversations = Object.values(coach.conversations);
    conversations.forEach((conversation) => {
      conversation.background(AppState.currentState !== 'active');
      void conversation.initialize();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      conversations.forEach((conversation) => conversation.background(state !== 'active'));
    });
    return () => {
      subscription.remove();
      conversations.forEach((conversation) => conversation.dispose());
    };
  }, [coach]);
  const navigator = useRef<((scope: CoachScope) => void) | null>(null);
  const launch = useCallback(
    (request: CoachOpenRequest = {}, scope: CoachScope = 'general') => {
      const prepared = coach?.conversations[scope].prepare(request);
      const show = () => navigator.current?.(scope);
      // Opened about something: show the Coach once the fresh conversation is in place, so the one
      // it replaced does not flash first. Otherwise at once.
      if (request.context && prepared) void prepared.finally(show);
      else show();
    },
    [coach],
  );
  const launcher = useMemo(() => ({ launch, navigator }), [launch]);
  return (
    <Context.Provider value={coach}>
      <LaunchContext.Provider value={launcher}>{children}</LaunchContext.Provider>
    </Context.Provider>
  );
}
/** Opens the Coach from anywhere in the app, optionally about one lift, session or workout. */
export function useCoachLaunch() {
  return useContext(LaunchContext).launch;
}
/** The app shell registers how the Coach screen is shown. */
export function useCoachNavigator(show: (scope: CoachScope) => void) {
  const { navigator } = useContext(LaunchContext);
  useEffect(() => {
    navigator.current = show;
  });
}
export function useCoach() {
  return useContext(Context);
}
