import { z } from 'zod';
import { ApiError } from '../../account/api/client';
import { scanSchema } from './models';

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
