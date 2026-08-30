'use client'

import { PREFERENCE_STORAGE, type UserPreferences } from '@trainingai/shared/user/preferences'

/**
 * The device half of server-backed preferences (Q-392).
 *
 * The owner's report was *"when i do a new install or open on computer - it loses all the saved
 * preferences"*. The engine — `users.preferences`, `GET`/`PATCH /api/user/preferences` — shipped
 * separately and **no read site called it**, so nothing user-visible had changed. This is what
 * connects them.
 *
 * **The conflict rule is settled and one-directional: the server wins.** `localStorage` is a seed
 * written *from* the server and never the reverse, which is the same rule Q-241 set for goals. So
 * `hydrate` overwrites the device copy without comparing, and `savePreference` writes both.
 *
 * **Seeding rather than reading through** is what keeps first paint synchronous: every surface here
 * already reads its `localStorage` key during render, and making them await a fetch would trade a
 * fixed bug for a flash of defaults on every launch.
 */

type PreferenceName = keyof UserPreferences

/** Encode for `localStorage`, which is not uniform: `ta_ss_widgets` is JSON, `ta_weight_lookback`
 *  a bare number, and the reminder toggles `String(boolean)` compared against the literal
 *  `'false'`. The map owns which is which so no call site has to remember. */
function encode(name: PreferenceName, value: unknown): string {
  return PREFERENCE_STORAGE[name].encoding === 'json' ? JSON.stringify(value) : String(value)
}

/**
 * Preferences that are mutually exclusive: when the server has one, the others are stale here.
 *
 * A brand preset and a custom hue cannot both apply — `theme-color-picker.tsx` reads the hue first
 * and lets it win — so a device that still holds a hue would override a preset chosen elsewhere.
 * Hydration does not delete an absent key (see below), so this is what resolves the pair.
 */
const EXCLUSIVE_GROUPS: readonly (readonly PreferenceName[])[] = [['brandTheme', 'brandHue']]

/**
 * Seed the device keys from the server bag.
 *
 * **It never deletes a key the bag does not carry, and that is a correction rather than a
 * shortcut.** The obvious rule is "absent means never set, so clear the device copy", which is
 * right for a settled system and wrong in the window that matters: `savePreference` writes locally
 * and PATCHes in the background, so between the tap and the acknowledgement the bag legitimately
 * lacks a key the user has just chosen. CI caught exactly that — the meal-label spec picked a
 * style, reloaded, and hydration wiped it — and **offline it never comes back at all**, because the
 * PATCH simply never lands.
 *
 * The server *could* distinguish "cleared" from "never set" by storing a null, but `mergePreferences`
 * deletes the key instead, so the GET cannot tell them apart. Changing that is a server change; not
 * deleting is the correct client behaviour either way.
 *
 * What this gives up is a key cleared on another device lingering here. The only clearing the app
 * does is the exclusive pair above, which `EXCLUSIVE_GROUPS` resolves.
 */
export function hydrateUserPreferences(prefs: UserPreferences | null | undefined): void {
  if (!prefs || typeof window === 'undefined') return
  for (const [name, { key }] of Object.entries(PREFERENCE_STORAGE)) {
    const value = prefs[name as PreferenceName]
    if (value === undefined) continue
    try {
      localStorage.setItem(key, encode(name as PreferenceName, value))
    } catch {
      // Private mode or quota. The server copy is still authoritative and the next launch retries.
    }
  }
  for (const group of EXCLUSIVE_GROUPS) {
    const chosen = group.find(n => prefs[n] !== undefined)
    if (!chosen) continue
    for (const other of group) {
      if (other === chosen) continue
      try { localStorage.removeItem(PREFERENCE_STORAGE[other].key) } catch { /* see above */ }
    }
  }
}

/**
 * Set one preference: the device copy now, the server copy in the background. `null` clears it.
 *
 * **Fire-and-forget on purpose, and it is not the outbox's job.** A preference is not a user
 * record — losing one PATCH costs a toggle that reverts on the next device, not data — and every
 * caller here is a tap that must feel instant (CLAUDE.md, "saves feel instant"). Queuing it would
 * add a synced domain, a local table and a push branch for a value the next write replaces
 * wholesale.
 *
 * The local write happens first and unconditionally, so an offline change still applies on this
 * device and is simply not carried to the next one.
 */
export function savePreference<K extends PreferenceName>(
  name: K, value: UserPreferences[K] | null,
): void {
  savePreferences({ [name]: value } as PreferencePatch)
}

/** A patch of one or more preferences. `null` clears a key — the route's own contract, and what
 *  lets a mutually-exclusive pair be expressed. */
export type PreferencePatch = { [K in PreferenceName]?: UserPreferences[K] | null }

/**
 * Set several preferences in one write.
 *
 * **Paired changes need this rather than two `savePreference` calls.** The theme picker sets a
 * brand preset and clears the custom hue, or the reverse; sent separately they are two PATCHes that
 * can land out of order and leave both keys set — which renders as the hue winning a choice the
 * user made for the preset.
 */
export function savePreferences(patch: PreferencePatch): void {
  if (typeof window === 'undefined') return
  for (const [name, value] of Object.entries(patch)) {
    const { key } = PREFERENCE_STORAGE[name as PreferenceName]
    try {
      if (value === null || value === undefined) localStorage.removeItem(key)
      else localStorage.setItem(key, encode(name as PreferenceName, value))
    } catch {
      // Private mode or quota — still try the server, which is the authority anyway.
    }
  }
  void fetch('/api/user/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => {
    // Offline or signed out. The device keeps the value; the next successful save carries it.
  })
}
