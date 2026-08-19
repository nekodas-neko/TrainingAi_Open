import type { LocalStore } from '@/lib/local-store'
import { resolveEatenAt } from './eaten-at'
import { DEFAULT_TZ } from '../date-utils'

/**
 * The local half of Q-413: resolve a food log's eaten-at against the meal window, on the device.
 *
 * The server resolves in `createFoodLog`, which covers the web route and the outbox push. The local
 * store still needs its own pass, because on the canonical runtime the local row **is** what the
 * nutrition screen reads — an unresolved local row shows the wrong time until a pull happens to
 * correct it, and offline there is no pull. `meal_types` is a synced local table, so the window is
 * already here; only the timezone has to be threaded in from the session.
 *
 * Returns the candidate unchanged if the meal type is not in the local store yet. A missing window
 * is not a reason to refuse a food log, and the server will resolve it on push regardless.
 */
export async function resolveLocalEatenAt(
  store: LocalStore,
  mealTypeId: string,
  date: string,
  at: Date,
  tz: string = DEFAULT_TZ,
): Promise<string> {
  try {
    const mealType = (await store.getMealTypes()).find(m => m.id === mealTypeId)
    if (!mealType) return at.toISOString()
    return resolveEatenAt({
      date,
      window: { timeStartHour: mealType.timeStartHour, timeEndHour: mealType.timeEndHour },
      at,
      tz,
    }).toISOString()
  } catch {
    // A local-store read failing must not lose the log — the caller's own catch falls back to the
    // API, and the server resolves there anyway.
    return at.toISOString()
  }
}
