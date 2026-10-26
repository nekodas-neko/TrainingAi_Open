import { TROPHY_SLOTS } from '@trainingai/shared/achievement-display'
import { invalidateTrophyPins } from '@/lib/cache-groups'

/** Where the trophy case lived before it was saved on the account (#3125). Read once, then removed. */
const LEGACY_KEY = 'ta_trophy_case'

export const TROPHY_PINS_KEY = 'trophy-pins'
export const TROPHY_PINS_URL = '/api/user/trophy-pins'

export type PinsSave = 'saved' | 'refused' | 'failed'

export function readLegacyPins(): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch { return [] }
}

export function clearLegacyPins() {
  try { localStorage.removeItem(LEGACY_KEY) } catch { /* ignore */ }
}

/**
 * Save the pins on the account, which is what friends see. 'refused' is the server saying no (a
 * trophy that is not unlocked, a malformed list): retrying the same list cannot work. 'failed' is
 * anything else — offline, a 5xx, a rate limit — where it can.
 */
export async function savePins(pins: readonly string[]): Promise<PinsSave> {
  let res: Response
  try {
    res = await fetch(TROPHY_PINS_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pins: pins.slice(0, TROPHY_SLOTS) }),
    })
  } catch { return 'failed' }
  if (res.status === 400 || res.status === 403) return 'refused'
  if (!res.ok) return 'failed'
  await invalidateTrophyPins().catch(() => {})
  return 'saved'
}

/**
 * Move the pins this browser kept before the account held them onto the account, once. Call it with
 * the account's own pins already read. An account that has pins keeps them; the old list is dropped
 * either way, so it can never overwrite a later edit.
 *
 * The old list is cut down to trophies that are unlocked now: the server refuses a whole list if any
 * id is locked or unknown, and a kept list would be retried on every load for ever. A refusal drops
 * the list; only a failure that could clear (offline, 5xx) keeps it for the next load.
 */
export async function carryOverLegacyPins(accountPins: readonly string[] | null, unlockedIds: ReadonlySet<string>) {
  // Nothing is known to be unlocked yet (achievements not loaded): decide on a later load.
  if (unlockedIds.size === 0) return
  const old = readLegacyPins()
  if (old.length > 0 && accountPins === null) {
    const usable = old.filter(id => unlockedIds.has(id)).slice(-TROPHY_SLOTS)
    if (usable.length > 0 && (await savePins(usable)) === 'failed') return
  }
  clearLegacyPins()
}
