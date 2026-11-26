import { plural } from '@trainingai/shared/format/plural';

/**
 * The closed updates strip's one line. A single update says what it is ("Week in review ready",
 * "Week in review couldn’t load"); several say how many. It used to read "1 ready" whatever the
 * entry was, which was also wrong for a load that had failed.
 */
export function updatesStripLabel(entries: readonly { label: string }[]): string {
  if (entries.length === 1) return entries[0].label;
  return plural(entries.length, 'update', 'updates');
}
