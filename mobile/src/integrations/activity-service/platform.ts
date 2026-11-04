import type { ActivityServiceStarter } from '../../features/activities/data/background-recording';
import type { ActivityServiceHost } from './shared-service';

// No foreground service in the browser preview.
export const activityServiceHost: ActivityServiceHost | undefined = undefined;
export const activityService: ActivityServiceStarter | undefined = undefined;
export const workoutStrapService: ActivityServiceStarter | undefined = undefined;
