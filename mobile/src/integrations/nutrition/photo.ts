import { FOOD_ITEM_IMAGE_MAX_BYTES } from '@trainingai/shared/nutrition/meal-image';
import type { ImagePickerAsset } from 'expo-image-picker';
import type { ImageRef } from 'expo-image-manipulator';
import { imageResize, imageSizeWithinPixels } from './image-size';
import {
  encodeWithinBudget,
  SCAN_IMAGE_MAX_BYTES,
  SCAN_IMAGE_MAX_PIXELS,
} from './image-encoding';

async function selectPhoto(camera: boolean) {
  // Bundle adapters upfront; evaluate native modules only when capture is requested.
  const picker = require('expo-image-picker') as typeof import('expo-image-picker');
  if (camera && !(await picker.requestCameraPermissionsAsync()).granted) {
    throw new Error('Camera access was not granted.');
  }
  const options = { quality: 1, base64: false, exif: false };
  const result = camera
    ? await picker.launchCameraAsync({ ...options, mediaTypes: ['images'] })
    : await picker.launchImageLibraryAsync({ ...options, mediaTypes: ['images'] });
  return result.canceled ? null : (result.assets[0] ?? null);
}

async function preparePhoto(asset: ImagePickerAsset, scan: boolean) {
  const manipulator =
    require('expo-image-manipulator') as typeof import('expo-image-manipulator');
  const files = require('expo-file-system') as typeof import('expo-file-system');
  async function render(
    source: string | ImageRef,
    resize?: { width?: number; height?: number },
  ) {
    const context = manipulator.ImageManipulator.manipulate(source);
    try {
      if (resize) {
        context.resize(resize);
      }
      return await context.renderAsync();
    } finally {
      context.release();
    }
  }
  async function encode(image: ImageRef, maxBytes: number) {
    return encodeWithinBudget(async (quality) => {
      const saved = await image.saveAsync({
        format: manipulator.SaveFormat.WEBP,
        compress: quality,
      });
      const file = new files.File(saved.uri);
      return {
        bytes: file.size,
        read: () => file.base64(),
        dispose: () => {
          try {
            file.delete();
          } catch {}
        },
      };
    }, maxBytes);
  }
  let image: ImageRef | null = null;
  let thumbnail: ImageRef | null = null;
  try {
    const size = scan
      ? imageSizeWithinPixels(asset.width, asset.height, SCAN_IMAGE_MAX_PIXELS)
      : imageResize(asset.width, asset.height, 128)[0]?.resize;
    image = await render(asset.uri, size);
    thumbnail = scan
      ? await render(image, imageResize(image.width, image.height, 128)[0]?.resize)
      : image;
    const small = await encode(thumbnail, FOOD_ITEM_IMAGE_MAX_BYTES);
    const preview = `data:image/webp;base64,${small.base64}`;
    const upload = scan ? await encode(image, SCAN_IMAGE_MAX_BYTES) : null;
    return upload
      ? {
          ...upload,
          mimeType: 'image/webp' as const,
          thumbnail: preview,
          width: image.width,
          height: image.height,
        }
      : { thumbnail: preview };
  } finally {
    if (thumbnail && thumbnail !== image) {
      thumbnail.release();
    }
    image?.release();
    const pickerCache = new files.Directory(files.Paths.cache, 'ImagePicker').uri;
    if (asset.uri.startsWith(pickerCache.endsWith('/') ? pickerCache : `${pickerCache}/`)) {
      try {
        new files.File(asset.uri).delete();
      } catch {}
    }
  }
}

export async function pickNutritionImage(camera: boolean, onPreparing?: () => void) {
  const image = await selectPhoto(camera);
  if (!image) {
    return null;
  }
  onPreparing?.();
  const prepared = await preparePhoto(image, true);
  if (!('base64' in prepared)) {
    throw new Error('Could not prepare the selected photo.');
  }
  return prepared;
}

export async function pickNutritionThumbnail() {
  const image = await selectPhoto(false);
  return image ? preparePhoto(image, false) : null;
}
