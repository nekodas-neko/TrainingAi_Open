import { msToHHMMInTz, toAestDay } from '@trainingai/shared/date-utils';
import type { SleepRow } from './models.ts';

// Morning hand-off to the Oura app (#2896). With the Oura API, last night's sleep reaches us only
// after the Oura app has opened and synced, so on a morning open we start Oura for a moment, come
// straight back, and wait for the night to arrive through the webhook.
export const OURA_PACKAGE = 'com.ouraring.oura';
export const HAND_BACK_MS = 2_000;
export const POLL_INTERVAL_MS = 5_000;
export const POLL_TIMEOUT_MS = 120_000;
// Local hours [start, end) that count as morning.
const MORNING_START_HOUR = 4;
const MORNING_END_HOUR = 12;

export type HandoffSkip =
  | 'disabled'
  | 'unsupported'
  | 'not_installed'
  | 'not_morning'
  | 'already_ran'
  | 'have_sleep'
  | 'not_connected';
export type HandoffDecision = { run: true; day: string } | { run: false; reason: HandoffSkip };

export function isMorning(now: number, timezone: string) {
  const hour = Number(msToHHMMInTz(now, timezone).slice(0, 2));
  return hour >= MORNING_START_HOUR && hour < MORNING_END_HOUR;
}

// Sleep is dated by the morning it ends, so last night is the row dated today.
export function hasLastNight(sleep: readonly SleepRow[], today: string) {
  return sleep.some(
    (night) => night.date === today && night.durationHours != null && !night.provisional,
  );
}

// Cheap local checks run first; the sleep refresh and the connection request only run when
// everything else says go. A manual "Sync now" skips the setting, the morning window and the
// once-a-morning guard, but never the rest.
export async function morningHandoffDecision(input: {
  manual?: boolean;
  enabled: boolean;
  supported: boolean;
  installed: () => boolean;
  lastRunDay: string | null;
  now: number;
  timezone: string;
  lastNight: (today: string) => Promise<boolean>;
  connected: () => Promise<boolean>;
}): Promise<HandoffDecision> {
  const manual = input.manual === true;
  if (!manual && !input.enabled) return { run: false, reason: 'disabled' };
  if (!input.supported) return { run: false, reason: 'unsupported' };
  const day = toAestDay(new Date(input.now), input.timezone);
  if (!manual && !isMorning(input.now, input.timezone)) return { run: false, reason: 'not_morning' };
  if (!manual && input.lastRunDay === day) return { run: false, reason: 'already_ran' };
  if (!input.installed()) return { run: false, reason: 'not_installed' };
  if (await input.lastNight(day)) return { run: false, reason: 'have_sleep' };
  if (!(await input.connected())) return { run: false, reason: 'not_connected' };
  return { run: true, day };
}

export type WaitOutcome = 'landed' | 'timeout' | 'cancelled';

// Re-checks for the night every `intervalMs` until it lands, `timeoutMs` passes or the caller
// cancels. A failed check counts as "not yet" so one network error does not end the wait.
export async function waitForNight(options: {
  landed: () => Promise<boolean>;
  cancelled: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<WaitOutcome> {
  const interval = options.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = options.now() + (options.timeoutMs ?? POLL_TIMEOUT_MS);
  while (options.now() < deadline) {
    await options.sleep(Math.min(interval, Math.max(0, deadline - options.now())));
    if (options.cancelled()) return 'cancelled';
    const found = await options.landed().catch(() => false);
    if (options.cancelled()) return 'cancelled';
    if (found) return 'landed';
  }
  return 'timeout';
}
