import type { ActivityServiceStarter } from '../../features/activities/data/background-recording';

// No foreground service in the browser preview.
export const activityService: ActivityServiceStarter | undefined = undefined;
