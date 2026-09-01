'use client'

import { useEffect, useRef } from 'react'
import { PREFERENCE_STORAGE, type UserPreferences } from '@trainingai/shared/user/preferences'

/**
 * The device half of server-backed preferences (Q-392).
 *
 * The owner's report was *"when i do a new install or open on computer - it loses all the saved
 * preferences"*. The engine — `users.preferences`, `GET`/`PATCH /api/user/preferences` — shipped
 * separately and **no read site called it**, so nothing user-visible had changed. This is what
 * connects them.
 *
 * **The conflict rule is "the server wins, EXCEPT over a change it has not seen yet" (LB-29).**
 * `localStorage` is a seed written from the server, so `hydrate` overwrites the device copy without
 * comparing — but only for keys whose last local write has been acknowledged. A key written here
 * and not yet PATCHed is marked unsynced, and hydration leaves it alone and re-sends it instead.
 *
 * Without that mark the seed loses the write that produced it: `savePreference` writes locally and
 * PATCHes in the background, so a reload in that window is answered with the server's *previous*
 * value, which is then written over the user's choice. Offline it is not a race but permanent —
 * the PATCH never lands, so every launch re-writes the old value. The owner asked for the change to
 * follow across devices, which rules out the simpler "only ever fill in a key the device lacks".
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
 * Preferences written here whose PATCH has not been acknowledged (LB-29).
 *
 * In `localStorage` rather than memory because **the reload is the whole problem** — a
 * session-scoped set does not survive the navigation that loses the value. One key holding a name
 * list, not a key each, so the set is read and written atomically.
 */
const UNSYNCED_KEY = 'ta_prefs_unsynced'

function readUnsynced(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(UNSYNCED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [])
  } catch {
    // Unparseable or unavailable. An empty set means hydration behaves exactly as it did before
    // this entry — the server wins — which is the safe direction to fail in.
    return new Set()
  }
}

function writeUnsynced(names: Set<string>): void {
  try {
    if (names.size === 0) localStorage.removeItem(UNSYNCED_KEY)
    else localStorage.setItem(UNSYNCED_KEY, JSON.stringify([...names]))
  } catch { /* private mode or quota */ }
}

/** Read a device value back as the type the schema expects, for re-sending an unsynced key. */
function decode(name: PreferenceName, raw: string | null): unknown {
  if (raw === null) return null
  const { encoding } = PREFERENCE_STORAGE[name]
  if (encoding === 'json') {
    try { return JSON.parse(raw) } catch { return null }
  }
  if (encoding === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  // The reminder toggles are `String(boolean)` compared against the literal 'false'.
  if (encoding === 'boolean') return raw !== 'false'
  return raw
}

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
  const unsynced = readUnsynced()
  for (const [name, { key }] of Object.entries(PREFERENCE_STORAGE)) {
    // LB-29: this key holds a change the server has not acknowledged, so its copy is older than
    // ours by definition. Seeding over it is what loses the choice that was just made.
    if (unsynced.has(name)) continue
    const value = prefs[name as PreferenceName]
    if (value === undefined) continue
    try {
      localStorage.setItem(key, encode(name as PreferenceName, value))
    } catch {
      // Private mode or quota. The server copy is still authoritative and the next launch retries.
    }
  }
  for (const group of EXCLUSIVE_GROUPS) {
    // An unsynced member of the pair is a choice in flight; clearing its partner from under it
    // would apply the server's older half of a pair the user has already replaced.
    if (group.some(n => unsynced.has(n))) continue
    const chosen = group.find(n => prefs[n] !== undefined)
    if (!chosen) continue
    for (const other of group) {
      if (other === chosen) continue
      try { localStorage.removeItem(PREFERENCE_STORAGE[other].key) } catch { /* see above */ }
    }
  }
  resendUnsynced(unsynced)
}

/**
 * Re-send the device's value for every key whose last PATCH is unaccounted for.
 *
 * This is what makes the offline case self-heal rather than merely survive: the mark persists
 * across launches, so the first launch with a network carries the change to the server, and the
 * mark clears. Without it a key would stay pinned to the device forever and never propagate —
 * which is the promise the owner chose against.
 */
function resendUnsynced(unsynced: Set<string>): void {
  if (unsynced.size === 0) return
  const patch: PreferencePatch = {}
  for (const name of unsynced) {
    if (!(name in PREFERENCE_STORAGE)) continue
    const n = name as PreferenceName
    ;(patch as Record<string, unknown>)[n] = decode(n, localStorage.getItem(PREFERENCE_STORAGE[n].key))
  }
  if (Object.keys(patch).length === 0) {
    writeUnsynced(new Set())
    return
  }
  void patchServer(patch, [...unsynced])
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

/**
 * The device half alone — no PATCH. For a write that cannot be news to the server.
 *
 * It exists because the conversion this module performed was not the one-to-one swap it looked
 * like: a `localStorage.setItem` in a mirror effect was free, and the same line calling
 * `savePreference` is a network write **on every mount**. One such site — the Health goals card —
 * put a PATCH into the launch burst and left it, and a `GET` behind it, unresolved for over fifty
 * seconds, which failed nine e2e specs on `waitUntil: 'networkidle'`. Measured 2026-08-30:
 * reverting that one line took `card-429-error-state` from a 45 s timeout to a 21.5 s pass.
 */
export function writePreferenceLocally<K extends PreferenceName>(
  name: K, value: UserPreferences[K] | null,
): void {
  if (typeof window === 'undefined') return
  const { key } = PREFERENCE_STORAGE[name]
  try {
    if (value === null || value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, encode(name, value))
  } catch { /* private mode or quota */ }
}

/**
 * Mirror a piece of component state into a preference: locally on mount, to the server only when
 * it CHANGES.
 *
 * Use this wherever the old code was `useEffect(() => localStorage.setItem(K, v), [v])`. Calling
 * `savePreference` from such an effect looks identical and is not — see `writePreferenceLocally`
 * for what that costs. A handler that runs because the user tapped something needs neither: call
 * `savePreference` there directly.
 */
export function usePersistedPreference<K extends PreferenceName>(
  name: K, value: UserPreferences[K],
): void {
  const seen = useRef<string | null>(null)
  useEffect(() => {
    const next = encode(name, value)
    // **The test is the VALUE, not the run count.** React's StrictMode invokes an effect twice on
    // mount, so a `firstRun` ref is already spent by the second invocation and PATCHes — in the
    // launch burst, which is exactly what this hook exists to prevent. Measured: the ref version
    // failed `card-429-error-state` identically to no guard at all.
    if (seen.current === next) return
    const firstRun = seen.current === null
    seen.current = next
    if (firstRun) writePreferenceLocally(name, value)
    else savePreference(name, value)
  }, [name, value])
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
  const names = Object.keys(patch)
  // Marked BEFORE the request, so a reload mid-flight finds the mark rather than racing it.
  const unsynced = readUnsynced()
  for (const n of names) unsynced.add(n)
  writeUnsynced(unsynced)

  void patchServer(patch, names)
}

/** PATCH the bag, and clear the unsynced mark for exactly the keys the server accepted. */
function patchServer(patch: PreferencePatch, names: string[]): Promise<void> {
  return fetch('/api/user/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then(res => {
    // Only a 2xx clears the mark. A 4xx/5xx leaves the key unsynced, so the device keeps winning
    // and the next hydration tries again — the same shape as the offline case.
    if (!res.ok) return
    const still = readUnsynced()
    for (const n of names) still.delete(n)
    writeUnsynced(still)
  }).catch(() => {
    // Offline or signed out. The mark persists, so the next launch re-sends it.
  })
}
