import { validWaterMlDeltaOrNull } from '@trainingai/shared/validation/body-metrics';
import type { HomeWidgets } from '../../integrations/widgets/types';

// The +250 ml button on the Nutrition widget works with the app closed: the widget queues a tap
// natively, and this applies it to the local store the next time the app runs, which queues the
// write for the server like any other water log (#3268). The tap is acknowledged only after the
// store holds it, so a crash in between loses nothing, and the store keeps the tap's id so a
// retry cannot add it twice.

export type PendingWater = { id: string; ml: number; at: number; date: string; user: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The taps the native queue holds; an entry that is not a well-formed tap is left out. */
export function parsePendingWater(raw: string): PendingWater[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item): PendingWater[] => {
    const value = item as Partial<PendingWater> | null;
    if (
      !value ||
      typeof value.id !== 'string' ||
      !UUID.test(value.id) ||
      typeof value.ml !== 'number' ||
      typeof value.at !== 'number' ||
      typeof value.date !== 'string' ||
      !DATE.test(value.date) ||
      typeof value.user !== 'string'
    ) {
      return [];
    }
    return [{ id: value.id, ml: value.ml, at: value.at, date: value.date, user: value.user }];
  });
}

/** The ids of queue entries that cannot be read as taps, so they do not wait forever. */
function unreadableIds(raw: string, readable: readonly PendingWater[]): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set(readable.map((entry) => entry.id));
    return parsed.flatMap((item) => {
      const id = (item as { id?: unknown } | null)?.id;
      return typeof id === 'string' && !known.has(id) ? [id] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Records the queued taps in order. A tap for another account, or one the water validator refuses,
 * is dropped; a failure to store one (the store is not ready) stops the drain and leaves it, and
 * every tap after it, queued for the next run. Returns how many taps were recorded.
 */
export async function drainPendingWater(
  widgets: Pick<HomeWidgets, 'peekPending' | 'ackPending'>,
  user: string,
  addWater: (ml: number, date: string, id: string) => Promise<void>,
): Promise<number> {
  const raw = widgets.peekPending();
  const taps = parsePendingWater(raw);
  const finished = unreadableIds(raw, taps);
  let recorded = 0;
  for (const tap of taps) {
    if (tap.user !== user || validWaterMlDeltaOrNull(tap.ml) === null) {
      finished.push(tap.id);
      continue;
    }
    try {
      await addWater(tap.ml, tap.date, tap.id);
    } catch {
      break;
    }
    finished.push(tap.id);
    recorded++;
  }
  if (finished.length > 0) widgets.ackPending(finished);
  return recorded;
}
