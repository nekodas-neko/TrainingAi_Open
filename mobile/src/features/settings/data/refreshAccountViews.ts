import { profileSpec, goalsSpec } from '../../health/data/models.ts';
import { programSpec, stylesSpec, phaseSetsSpec } from '../../workouts/data/models.ts';
import type { WorkoutResources, ResourceSpec } from '../../workouts/data/WorkoutResources.ts';

const requiredViews: ResourceSpec<unknown>[] = [
  profileSpec,
  goalsSpec,
  programSpec,
  stylesSpec,
  phaseSetsSpec,
];
const restorePaths = [
  '/api/workout-data',
  '/api/workout-history',
  '/api/progress-summary',
  '/api/nutrition',
  '/api/measured-rmr',
  '/api/dexa-scans',
];

export async function refreshAccountViews(resources: WorkoutResources, restore = false) {
  resources.invalidate([
    ...requiredViews.map((view) => view.path),
    ...(restore ? restorePaths : []),
  ]);
  await Promise.all(requiredViews.map((view) => resources.load(view, true)));
  await resources.refreshVisible();
  const failure = requiredViews.map((view) => resources.state(view).error).find(Boolean);
  if (failure) throw new Error(failure);
}
