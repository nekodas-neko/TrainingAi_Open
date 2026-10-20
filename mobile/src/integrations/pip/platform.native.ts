import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { PictureInPicture } from './types';

// Absent on iOS and on builds made before the module existed.
export const pictureInPicture: PictureInPicture | null =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<PictureInPicture>('PictureInPicture')
    : null;
