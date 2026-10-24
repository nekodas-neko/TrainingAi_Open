import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { WorkoutStatusModule } from './types';

// Absent on iOS (jsboiss's Live Activity is separate) and on builds made before the module existed.
export const workoutStatus: WorkoutStatusModule | null =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<WorkoutStatusModule>('WorkoutStatus')
    : null;
