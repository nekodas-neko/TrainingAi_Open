import * as TaskManager from 'expo-task-manager';
import { BACKGROUND_LOCATION_TASK, deliverBackgroundLocations } from './background-fixes';

// Imported from index.ts so it is registered before React starts: Android calls the task from a
// foreground service, with the screen off, and a task defined later would be missed.
TaskManager.defineTask<{ locations?: Parameters<typeof deliverBackgroundLocations>[0] }>(
  BACKGROUND_LOCATION_TASK,
  async ({ data, error }) => {
    if (!error) {
      deliverBackgroundLocations(data?.locations);
    }
  },
);
