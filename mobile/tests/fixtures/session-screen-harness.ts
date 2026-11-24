// Renders the REAL SessionScreen (or the copy of `main`'s, for the snapshot) with stand-ins for its
// collaborators (`plan-render-stubs.ts`). Shared by the render test and the capture script.
import { registerHooks } from 'node:module';
import { createElement, type ReactElement } from 'react';

const stubs = new URL('./plan-render-stubs.ts', import.meta.url).href;
const screens = new URL('../../src/features/workouts/screens/', import.meta.url).href;
const components = new URL('../../src/features/workouts/components/', import.meta.url).href;
const subjects = new Set([
  screens + 'SessionScreen.tsx',
  screens + 'SessionScreen.main.tsx',
  components + 'PlanStartCard.tsx',
]);
const stubbed = new Set([
  'react-native',
  '../../../shared/ui',
  '../../../shared/ui/TouchSurface',
  '../../../shared/theme/ThemeProvider',
  '../../coach/components/LiftCoachMenu',
  '../WorkoutProvider',
  '../logging/WorkoutJournalProvider',
  '../components/ExercisePreviewCard',
  '../components/StartWorkoutCard',
  '../components/SessionExerciseList',
  '../components/WorkoutLayout',
  '../components/PrescriptionControls',
  '../components/ExerciseHistory',
  '../data/useSessionPreparation',
  '../data/WorkoutDataProvider',
]);
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL && subjects.has(context.parentURL) && stubbed.has(specifier)) {
      return { url: stubs, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const server = 'react-dom/server';
const { renderToStaticMarkup } = (await import(server)) as {
  renderToStaticMarkup: (element: ReactElement) => string;
};
type Component = (props: never) => ReactElement;
export const load = async (file: string, name: string) =>
  ((await import(screens + file)) as Record<string, Component>)[name]!;
export const loadCard = async () =>
  ((await import(components + 'PlanStartCard.tsx')) as { PlanStartCard: Component }).PlanStartCard;
export const render = (component: Component, props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(component as never, props));
