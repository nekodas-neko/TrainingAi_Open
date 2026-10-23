import {
  validWaterMlDeltaOrNull,
  WATER_ML_DELTA_MAX,
} from '@trainingai/shared/validation/body-metrics';

/**
 * A typed water amount, judged the way the current app's Log button does: nothing to log until
 * there is a number, and an amount the server would quarantine is refused at the keyboard rather
 * than saved and lost. An empty field is an unfinished entry, not an error.
 */
export function waterEntry(raw: string): { ml: number | null; error: string | null } {
  if (raw.trim() === '') return { ml: null, error: null };
  const typed = parseFloat(raw);
  if (!Number.isFinite(typed)) return { ml: null, error: 'Enter a number' };
  const ml = validWaterMlDeltaOrNull(typed);
  return ml === null || ml < 1
    ? { ml: null, error: `Enter a value between 1 and ${WATER_ML_DELTA_MAX.toLocaleString('en-US')} ml` }
    : { ml, error: null };
}
