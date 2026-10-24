import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { HomeWidgets } from './types';

// Absent on iOS and on builds made before the module existed.
export const homeWidgets: HomeWidgets | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<HomeWidgets>('HomeWidgets') : null;
