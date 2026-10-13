import { withPngDensity } from '@trainingai/shared/nutrition/png-density';
import { randomUUID } from 'expo-crypto';
import { Platform,Share } from 'react-native';
import { mealLabelArtwork } from '../../features/nutrition/data/meal-label';
import { labelPrintDpi } from '../../features/nutrition/data/meal-label-geometry';
import type { SavedMeal } from '../../features/nutrition/data/models';
export async function shareLabelImage(base64: string, name: string) {
  const bytes = Uint8Array.from(atob(base64.replace(/^data:image\/png;base64,/, '')), (c) =>
    c.charCodeAt(0),
  );
  const png = withPngDensity(bytes, labelPrintDpi(1179));
  const { File, Paths } = await import('expo-file-system');
  const file = new File(
    Paths.cache,
    `${name.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80) || 'meal'}-${randomUUID()}.png`,
  );
  file.create();
  file.write(png);
  try {
    const sharing = await import('expo-sharing');
    if (!(await sharing.isAvailableAsync())) {
      throw new Error('Sharing is unavailable.');
    }
    await sharing.shareAsync(file.uri, {
      mimeType: 'image/png',
      UTI: 'public.png',
      dialogTitle: name + ' label',
    });
  } finally {
    file.delete();
  }
}
export async function mealLabelHtml(meal: SavedMeal, style: string) {
  const artwork = mealLabelArtwork(meal, style);
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:50mm 50mm;margin:0}html,body{margin:0;width:50mm;height:50mm;background:#fff}svg{width:50mm;height:50mm;display:block}</style></head><body>${artwork.svg}</body></html>`;
}
export async function exportMealLabel(meal: SavedMeal, style: string, print: boolean) {
  const html = await mealLabelHtml(meal, style);
  if (Platform.OS === 'web') {
    await Share.share({
      message: mealLabelArtwork(meal, style).payload.text,
      title: meal.name,
    });
    return;
  }
  const printing = await import('expo-print');
  if (print) {
    await printing.printAsync({ html });
    return;
  }
  const file = await printing.printToFileAsync({ html, width: 142, height: 142 });
  try {
    const sharing = await import('expo-sharing');
    if (!(await sharing.isAvailableAsync())) {
      throw new Error('Sharing is unavailable.');
    }
    await sharing.shareAsync(file.uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: meal.name + ' label',
    });
  } finally {
    const { File } = await import('expo-file-system');
    new File(file.uri).delete();
  }
}
