import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useWorkoutResources } from '../workouts/data/WorkoutDataProvider';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import { useNutrition } from '../nutrition/data/NutritionProvider';
import { useHome } from '../home/data/HomeProvider';
import { CoachConversation } from './data/CoachConversation';
import { CoachActions } from './data/CoachActions';
import { scopes, type CoachScope } from './data/models';
import { todayInTz } from '@trainingai/shared/date-utils';

export type Coach = {
  conversations: Record<CoachScope, CoachConversation>;
  actions: CoachActions;
};
const Context = createContext<Coach | null>(null);
export function CoachStateProvider({
  coach,
  children,
}: PropsWithChildren<{ coach: Coach | null }>) {
  return <Context.Provider value={coach}>{children}</Context.Provider>;
}
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
  return <Context.Provider value={coach}>{children}</Context.Provider>;
}
export function useCoach() {
  return useContext(Context);
}
