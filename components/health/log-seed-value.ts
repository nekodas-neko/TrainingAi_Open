import type { BodyMetaRow } from "@/app/api/body-metadata/route";

/**
 * The text a body-metric log sheet's input starts with: today's value for that field, so saving it
 * unchanged writes back what is already stored. Shared by Home's Log value sheet and Health's
 * metric log sheet, which had each grown their own copy.
 *
 * - **Steps seed the device's own count** (#3095). Today's `steps` may include a treadmill session's,
 *   added on read; saving that figure would write the session's steps into body_metrics as a manual
 *   reading, and the next read would add them a second time. `deviceSteps` is set exactly when the
 *   two differ.
 * - **Weight falls back to the latest recent reading** when today has none, so the sheet opens on a
 *   sensible number rather than blank.
 */
export function logSeedValue(field: string, today: BodyMetaRow | null, recent: readonly BodyMetaRow[]): string {
  let current: unknown = today?.[field as keyof BodyMetaRow];
  if (field === "steps" && today?.deviceSteps !== undefined) current = today.deviceSteps;
  if (field === "weightKg" && current == null) current = recent.find(r => r.weightKg != null)?.weightKg ?? null;
  return current != null ? String(current) : "";
}
