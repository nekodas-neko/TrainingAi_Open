import { z } from 'zod';
import {
  base64ImageBytes,
  SCAN_IMAGE_MAX_BYTES,
  SCAN_IMAGE_MAX_PIXELS,
} from '../../../integrations/nutrition/image-encoding';
import { rejectMealImage } from '@trainingai/shared/nutrition/meal-image';
export const photoDraftSchema = z
  .object({
    base64: z
      .string()
      .min(4)
      .max(Math.ceil(SCAN_IMAGE_MAX_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    mimeType: z.literal('image/webp'),
    thumbnail: z
      .string()
      .max(24 * 1024)
      .refine((value) => !rejectMealImage(value)),
    bytes: z.number().int().positive().max(SCAN_IMAGE_MAX_BYTES),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .refine(
    (value) =>
      base64ImageBytes(value.base64) === value.bytes &&
      value.width * value.height <= SCAN_IMAGE_MAX_PIXELS,
  );
