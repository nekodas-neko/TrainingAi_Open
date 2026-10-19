import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { MediaSave } from './types';

// Absent on iOS and on builds made before the module existed.
export const mediaSave: MediaSave | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<MediaSave>('MediaSave') : null;
