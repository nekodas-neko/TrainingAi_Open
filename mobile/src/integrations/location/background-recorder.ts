import type { BackgroundRecorder } from '../../features/activities/data/background-recording';

// No foreground service in the browser preview.
export const backgroundRecorder: BackgroundRecorder | undefined = undefined;
