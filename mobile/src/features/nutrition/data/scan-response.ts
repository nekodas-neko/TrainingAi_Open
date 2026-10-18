import { z } from 'zod';
import { ApiError } from '../../account/api/client';
import {
  ingredientsToEntries,
  lookupHitSource,
  scanOriginToSource,
  sourceAfterEdit,
  type NewFoodEntry,
} from '@trainingai/shared/nutrition/food-source';
import type { NutritionIngredient } from '@trainingai/shared/types/nutrition';
import { scanSchema, type Scan } from './models';

export class UnidentifiedFood extends Error {}

export function readFoodScan(value: unknown) {
  if (z.object({ error: z.string() }).safeParse(value).success) {
    throw new UnidentifiedFood();
  }
  const multiple = z.object({ candidates: z.array(scanSchema) }).safeParse(value);
  if (multiple.success && multiple.data.candidates.length > 0) {
    return multiple.data.candidates;
  }
  return [scanSchema.parse(value)];
}

export function foodScanError(error: unknown) {
  if (error instanceof UnidentifiedFood) {
    return 'No food was identified. Try another photo or describe what you ate.';
  }
  if (error instanceof ApiError) {
    if (error.notice) return error.notice;
    if (error.status === 401 || error.status === 403) {
      return 'Your account could not authorise this analysis. Check your sign-in in Settings.';
    }
    if (error.status === 429) {
      return 'Too many analysis requests. Wait a minute before retrying.';
    }
    if (error.status === 413) {
      return 'The photo is too large to analyse. Try a smaller image.';
    }
    if (error.status === 502) {
      return 'The server’s food-analysis service failed (502). Retry the photo or enter the food by hand.';
    }
    return `Food analysis failed on the server (${error.status}). Your draft is still here.`;
  }
  if (error instanceof z.ZodError) {
    return 'The server returned an unreadable food estimate. Your draft is still here.';
  }
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) {
    return 'Food analysis timed out. Check your connection, then retry the photo or enter it by hand.';
  }
  return 'Could not reach food analysis. Check your connection and retry. Your draft is still here.';
}

/** The figures a scan returned, kept so a save can tell whether the person changed them (#2925). */
export type ScanBasis = Pick<
  Scan,
  'calories' | 'proteinG' | 'carbsG' | 'fatG' | 'servingSizeG'
>;

/**
 * The `source` a scanned food is stored under before any edit, as the current app stores it. A name
 * search hit is a database number, not a model's, so it takes `lookupHitSource`.
 */
export function scanSource(scan: Scan): NewFoodEntry['source'] {
  return scan.origin === 'search'
    ? lookupHitSource(scan)
    : scanOriginToSource(scan.origin);
}

export function scanBasis(scan: Scan): ScanBasis {
  const { calories, proteinG, carbsG, fatG, servingSizeG } = scan;
  return { calories, proteinG, carbsG, fatG, servingSizeG };
}

/** A scanned food the person edited is hand-entered, so the scan repair leaves their numbers alone. */
export function savedSource(
  scanned: string | null,
  basis: ScanBasis | null,
  form: ScanBasis,
  fallback: string,
): string {
  if (!scanned) return fallback;
  return sourceAfterEdit(scanned as NewFoodEntry['source'], basis, form);
}

/** One entry per ingredient, through the same shared split the current app logs. */
export function ingredientEntries(
  ingredients: NutritionIngredient[],
  quantity: number,
  source: string,
) {
  return ingredientsToEntries(ingredients, quantity, source as NewFoodEntry['source']);
}

/** A saved food with this barcode, so a re-scan needs no network (LB-158). */
export function savedBarcodeFood<T extends { barcode?: string | null }>(
  foods: T[],
  code: string,
): T | null {
  return foods.find((food) => !!food.barcode && food.barcode === code) ?? null;
}

/** The barcode route reads `code`; anything else is a 400 that reads as "not found". */
export async function lookupBarcodeScan(
  connection: { get: (path: string, query?: Record<string, string>) => Promise<unknown> },
  code: string,
): Promise<Scan> {
  return scanSchema.parse(await connection.get('/api/nutrition/barcode', { code }));
}

/** The current app's three barcode answers: not in the database, database down, or our failure. */
export function barcodeError(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) {
    return 'No match found. This product isn’t in the database. Try a photo, description or manual entry.';
  }
  if (error instanceof ApiError && error.status === 503) {
    return 'Food database unavailable. Open Food Facts is not responding right now. Scanning a photo still works, and so does entering it manually.';
  }
  if (error instanceof ApiError && error.status === 429) {
    return 'Too many barcode lookups. Wait a minute before retrying.';
  }
  return 'Network error looking up barcode. Check your connection, or enter the food by hand.';
}

/** Retrying cannot help while the AI is paused, so the photo retry is not offered then. */
export function photoRetryAllowed(error: unknown): boolean {
  return !(error instanceof ApiError && !!error.notice);
}
