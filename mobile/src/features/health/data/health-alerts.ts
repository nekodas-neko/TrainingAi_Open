import {
  computeHealthAlertActions,
  firedToday,
  healthAlertInput,
  recordFired,
  type HealthAlertSources,
  type HealthAlertType,
} from '@trainingai/shared/health/health-alerts';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';

/** Which types fired on which local day, so each fires once a day however often the app opens. */
export const HEALTH_ALERTS_FIRED_KEY = 'health-alerts-fired.v1';

export type HealthAlertsResult =
  | { status: 'off' | 'no-permission' | 'no-data' }
  | { status: 'checked'; fired: HealthAlertType[] };

export type HealthAlertsRun = {
  storage: Pick<ScopedStorage, 'get' | 'set'>;
  enabled: boolean;
  permission: boolean;
  /** The user's local day, from `todayInTz()`. */
  today: string;
  /** Null for a response that is not loaded (no cache and no network). */
  sources: HealthAlertSources;
  /** Posts the notification; false when it was not shown, so the type is not counted as sent. */
  post: (type: HealthAlertType, title: string, body: string) => Promise<boolean>;
};

function parseFired(raw: string | null) {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Readiness and the battery arrive separately, and a re-render can start a second run while the
// first is still posting. Runs go one at a time, so the second sees what the first recorded.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Evaluates the alerts for the data in hand: the same decision as the current app, from
 * `@trainingai/shared`. Posts what fires and records it per type for the day.
 */
export function runHealthAlerts(run: HealthAlertsRun): Promise<HealthAlertsResult> {
  const next = queue.then(() => evaluate(run));
  queue = next.catch(() => undefined);
  return next;
}

async function evaluate(run: HealthAlertsRun): Promise<HealthAlertsResult> {
  if (!run.enabled) return { status: 'off' };
  if (!run.permission) return { status: 'no-permission' };
  if (!run.sources.readiness && !run.sources.battery) return { status: 'no-data' };
  let map = parseFired(await run.storage.get(HEALTH_ALERTS_FIRED_KEY).catch(() => null));
  const actions = computeHealthAlertActions(
    healthAlertInput(run.sources),
    firedToday(map, run.today),
  );
  const fired: HealthAlertType[] = [];
  for (const action of actions) {
    if (action.type !== 'fire') continue;
    if (!(await run.post(action.alertType, action.title, action.body))) continue;
    map = recordFired(map, [action], run.today);
    fired.push(action.alertType);
    await run.storage.set(HEALTH_ALERTS_FIRED_KEY, JSON.stringify(map));
  }
  return { status: 'checked', fired };
}
