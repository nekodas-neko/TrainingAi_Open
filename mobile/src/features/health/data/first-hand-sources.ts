import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils';
import {
  knownFirstHandSources,
  type FirstHandSources,
} from '@trainingai/shared/health/health-connect-origin';
import { readinessSpec } from './models.ts';

/** The slice of the resource store the lookup uses, so a test can stand in for it. */
export type ReadinessResources = {
  load(spec: ReturnType<typeof readinessSpec>): Promise<unknown>;
  state(spec: ReturnType<typeof readinessSpec>): {
    data?: { connectedSources?: unknown } | null;
  };
};

/**
 * Whether Oura Cloud is connected, from today's readiness payload (#3115), so the Oura app's own
 * Health Connect records are not imported twice. By the one cold-start rule shared with the current
 * app (#3197): a payload that is not today's, a failed load and a first offline run on a new day
 * are unknown, and unknown keeps Oura's copies.
 */
export async function loadFirstHandSources(
  resources: ReadinessResources | null | undefined,
  timezone: string | null | undefined,
): Promise<FirstHandSources | null> {
  if (!resources) return null;
  const today = todayInTz(timezone ?? DEFAULT_TZ);
  const spec = readinessSpec(today);
  await resources.load(spec);
  // The spec is keyed by today's date, so what it holds is today's payload.
  return knownFirstHandSources(resources.state(spec).data?.connectedSources, spec.partition, today);
}
