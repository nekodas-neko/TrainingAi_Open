import { DEFAULT_MEAL_LABEL_STYLE } from '@trainingai/shared/nutrition/meal-label-geometry';
import { labelStyle } from './meal-label';

/** Food search regions the picker offers; the account stores the code as `foodRegion`. */
export const FOOD_REGIONS = ['AU', 'NZ', 'US', 'GB', 'CA'] as const;
export const DEFAULT_FOOD_REGION = 'AU';

/**
 * The account's value wins, so a reinstall or a second phone gets it back; a phone whose account has
 * none yet keeps what was chosen on it (the local draft), and only then the default.
 */
export function foodRegionChoice(account: string | undefined, local: string | undefined): string {
  return account || local || DEFAULT_FOOD_REGION;
}
export function mealLabelStyleChoice(account: string | undefined, local: string | undefined) {
  return labelStyle(account || local || DEFAULT_MEAL_LABEL_STYLE);
}
/** The PATCH bodies, in the keys the current app writes to `/api/user/preferences`. */
export const foodRegionPatch = (region: string) => ({ foodRegion: region.trim().slice(0, 8) });
export const mealLabelStylePatch = (style: string) => ({ mealLabelStyle: labelStyle(style) });
