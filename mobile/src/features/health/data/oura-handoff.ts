import { msToHHMMInTz, toAestDay } from '@trainingai/shared/date-utils';
import type { SleepRow } from './models.ts';
import type { HandoffOutcome } from '../../../integrations/app-handoff/types.ts';

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

// Cheap local checks run first, then the connection request, and the sleep refresh only for a
// connected user. A manual "Sync now" skips the setting, the morning window and the
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
  if (!(await input.connected())) return { run: false, reason: 'not_connected' };
  if (await input.lastNight(day)) return { run: false, reason: 'have_sleep' };
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

// What the Home card shows about the hand-off, for the local day it applies to. The last three are
// the answer to a manual Sync now that could not open Oura.
export type HandoffStatus =
  | 'idle'
  | 'syncing'
  | 'timeout'
  | 'not_connected'
  | 'not_installed'
  | 'not_opened';
export type HandoffState = { status: HandoffStatus; day: string | null };
export const IDLE: HandoffState = { status: 'idle', day: null };

export type HandoffRun =
  | { kind: 'skipped'; reason: HandoffSkip | 'running' | 'not_ready' | 'not_foreground' }
  | { kind: 'not_opened'; outcome: HandoffOutcome | 'failed' }
  | { kind: 'waited'; outcome: 'returned' | 'stayed_behind'; wait: WaitOutcome };

export type HandoffDeps = {
  // The stored settings, or null while they are not loaded.
  settings: () => Promise<{ enabled: boolean; lastRunDay: string | null } | null>;
  supported: boolean;
  installed: () => boolean;
  now: () => number;
  timezone: () => string;
  connected: () => Promise<boolean>;
  lastNight: (day: string) => Promise<boolean>;
  // Whether TrainingAi is in front right now (AppState 'active').
  active: () => boolean;
  saveDay: (day: string | null) => Promise<void>;
  open: (manual: boolean) => Promise<{ outcome: HandoffOutcome }>;
  // Oura opened but TrainingAi could not come back: automatic runs must stop.
  stayedBehind: (day: string) => Promise<void>;
  wait: (day: string) => Promise<WaitOutcome>;
  setState: (state: HandoffState) => void;
};

// The morning hand-off's whole sequence, one run at a time (#2896). Returning to the front while a
// run is in flight starts nothing. An automatic run that found Oura disconnected or the night
// already here is not repeated that day, so foregrounds do not keep forcing refreshes.
export function createHandoffRunner(deps: HandoffDeps) {
  let running = false;
  let checkedDay: string | null = null;
  async function run(manual: boolean): Promise<HandoffRun> {
    if (running) return { kind: 'skipped', reason: 'running' };
    running = true;
    try {
      return await sequence(manual);
    } finally {
      running = false;
    }
  }
  async function sequence(manual: boolean): Promise<HandoffRun> {
    const settings = await deps.settings();
    if (!settings) return { kind: 'skipped', reason: 'not_ready' };
    const now = deps.now();
    const timezone = deps.timezone();
    const today = toAestDay(new Date(now), timezone);
    const decision = await morningHandoffDecision({
      manual,
      enabled: settings.enabled,
      supported: deps.supported,
      installed: deps.installed,
      lastRunDay: !manual && checkedDay === today ? today : settings.lastRunDay,
      now,
      timezone,
      lastNight: deps.lastNight,
      connected: deps.connected,
    });
    if (!decision.run) {
      if (decision.reason === 'not_connected' || decision.reason === 'have_sleep') {
        checkedDay = today;
      }
      if (manual) {
        deps.setState(
          decision.reason === 'not_connected' || decision.reason === 'not_installed'
            ? { status: decision.reason, day: today }
            : IDLE,
        );
      }
      return { kind: 'skipped', reason: decision.reason };
    }
    // The checks above wait on the network; Oura must never open once the user has left.
    if (!deps.active()) return { kind: 'skipped', reason: 'not_foreground' };
    // Recorded before Oura opens, so coming back to the front cannot start it again.
    await deps.saveDay(decision.day);
    if (!deps.active()) {
      await deps.saveDay(settings.lastRunDay);
      return { kind: 'skipped', reason: 'not_foreground' };
    }
    deps.setState({ status: 'syncing', day: decision.day });
    const outcome = await deps
      .open(manual)
      .then((result) => result.outcome)
      .catch(() => 'failed' as const);
    if (outcome !== 'returned' && outcome !== 'stayed_behind') {
      if (outcome === 'not_foreground' && !manual) await deps.saveDay(settings.lastRunDay);
      deps.setState(manual ? { status: 'not_opened', day: decision.day } : IDLE);
      return { kind: 'not_opened', outcome };
    }
    if (outcome === 'stayed_behind') await deps.stayedBehind(decision.day);
    const wait = await deps.wait(decision.day);
    if (wait !== 'cancelled') {
      deps.setState(wait === 'landed' ? IDLE : { status: 'timeout', day: decision.day });
    }
    return { kind: 'waited', outcome, wait };
  }
  return { run };
}

// The state the Home card should show today: anything recorded for an earlier day, or a
// timeout once the automatic setting is off, reads as idle.
export function currentHandoffState(state: HandoffState, today: string, enabled: boolean) {
  if (state.status === 'idle' || state.day !== today) return IDLE;
  if (!enabled && state.status !== 'syncing') return IDLE;
  return state;
}
