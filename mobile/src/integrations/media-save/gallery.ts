import type { MediaSave } from './types.ts';

export type SaveOutcome = { ok: true } | { ok: false; reason: string; error?: unknown };

/**
 * The file name the current app gives a saved label (`components/nutrition/meal-label-sheet.tsx`):
 * the meal's name without punctuation, then `-label.png`. The native side trims it further.
 */
export function labelFilename(mealName: string): string {
  return `${mealName.replace(/[^\w -]/g, '')}-label.png`;
}

/**
 * Write a PNG to the gallery. Never throws: the sheet shows the reason, as the current app's
 * toast does (`lib/media/save-to-gallery.ts`). No permission is asked for — Android 10+ needs none
 * for a MediaStore insert, and older versions are reported unavailable instead.
 */
export async function saveImageToGallery(
  media: MediaSave | null,
  png: Uint8Array,
  filename: string,
): Promise<SaveOutcome> {
  if (!media) {
    return { ok: false, reason: 'this app build cannot save images — update the APK' };
  }
  try {
    if (!media.isAvailable()) {
      return { ok: false, reason: 'saving to the gallery needs Android 10 or newer' };
    }
    await media.saveImage(toBase64(png), filename, 'image/png');
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: (error as Error)?.message || 'the gallery refused the file', error };
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
