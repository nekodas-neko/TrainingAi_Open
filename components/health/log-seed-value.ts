import type { BodyMetaRow } from "@/app/api/body-metadata/route";
import { logSeedReading } from "@trainingai/shared/health/activity-steps";

/**
 * The text a body-metric log sheet's input starts with, for Home's Log value sheet and Health's
 * metric log sheet. The reading itself comes from the shared `logSeedReading`, which Preview's
 * sheets use too (#3095): today's stored value, and for steps the device's own count.
 *
 * Weight falls back to the latest recent reading when today has none, so the sheet opens on a
 * sensible number rather than blank.
 */
export function logSeedValue(field: string, today: BodyMetaRow | null, recent: readonly BodyMetaRow[]): string {
  let current = logSeedReading(field, today as (BodyMetaRow & Record<string, unknown>) | null);
  if (field === "weightKg" && current == null) current = recent.find(r => r.weightKg != null)?.weightKg ?? null;
  return current != null ? String(current) : "";
}
