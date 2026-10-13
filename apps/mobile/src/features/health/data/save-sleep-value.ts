import { verdictToStoredFeel, type StoredSleepVerdict } from './sleep-verdict-copy';
const NEUTRAL_SLEEP_FEEL = 3;
export function saveSleepValue(
  correction: number | null,
  verdict: StoredSleepVerdict | null,
): {
  value: number;
  touched: boolean;
} {
  if (correction != null) return { value: correction, touched: true };
  if (verdict) return { value: verdictToStoredFeel(verdict.verdict), touched: false };
  return { value: NEUTRAL_SLEEP_FEEL, touched: false };
}
