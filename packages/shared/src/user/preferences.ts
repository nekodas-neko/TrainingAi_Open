import { z } from 'zod'

/**
 * The user's saved preferences — one JSONB bag on `users`, server-authoritative, seeded into
 * `localStorage` for instant first paint (Q-392).
 *
 * **Why one blob rather than a column each.** Preferences are an open-ended, growing set of
 * client-shaped values that nothing queries — no report asks "which users chose ring style 12".
 * A column each means a migration for every new toggle, and this repo's migration discipline
 * (number claimed against open PRs, idempotent, corrective-migration-if-wrong) makes each one a
 * real cost. Half the list is arrays and maps anyway, so it would be JSON inside a column either
 * way. `body_metrics.source_map` and `oura_daily.contributors` are the same shape already.
 *
 * The trade accepted: no DB-level typing and no per-key query. This schema is the type, and both
 * sides import it, which is stronger than a column type the client never sees. Going blob →
 * columns later is a migration that reads the blob; neither direction is destructive.
 *
 * **Every field is optional and nothing is defaulted here.** An absent key means "never set", which
 * is what lets a PATCH from one device merge instead of clobbering what another set. Defaults stay
 * at the read sites, where they already are.
 */

/** A storage-key-shaped string: a tile key, a section key, a colour token. Bounded, not
 *  enumerated — these lists live in `lib/home/home-prefs.ts` and adding one there must not need a
 *  schema change here. */
const Key = z.string().max(40)
/** A colour token or hex, keyed by whatever the surface keys by. */
const ColorMap = z.record(Key, z.string().max(40))

export const UserPreferencesSchema = z.object({
  // ── Home layout and colour ────────────────────────────────────────────────────
  homeWidgets:        z.array(Key).max(20).optional(),
  homeCards:          z.array(Key).max(30).optional(),
  homeSectionOrder:   z.array(Key).max(40).optional(),
  homeHiddenSections: z.array(Key).max(40).optional(),
  pillColors:         ColorMap.optional(),
  cardColors:         ColorMap.optional(),
  scoreRingStyle:     Key.optional(),
  /** The read site accepts 7 or 30 today and coerces anything else to 7; the bound here is wider
   *  on purpose, so adding a third window is a one-line change at the read site. */
  weightLookback:     z.number().int().min(1).max(3650).optional(),
  goalsProgressView:  Key.optional(),

  // ── Theme ─────────────────────────────────────────────────────────────────────
  brandTheme:         Key.optional(),
  brandHue:           z.number().int().min(0).max(360).optional(),
  /** The dynamic-background store's persisted state, opaque here: it is a Zustand `persist` bag
   *  whose shape belongs to `lib/stores/background-settings-store.ts`, and duplicating it would be
   *  a second definition that drifts. Bounded by the route's body limit, not by this schema. */
  backgroundSettings: z.record(Key, z.unknown()).optional(),

  // ── Elsewhere ─────────────────────────────────────────────────────────────────
  mealLabelStyle:     Key.optional(),
  restDurationSec:    z.number().int().min(0).max(3600).optional(),
  foodRegion:         z.string().max(8).optional(),

  // ── Reminder toggles ──────────────────────────────────────────────────────────
  mealReminders:      z.boolean().optional(),
  healthAlerts:       z.boolean().optional(),
  dayReviewReminders: z.boolean().optional(),
  calendarSync:       z.boolean().optional(),
}).strict()

/**
 * Where each preference lives on the device, and how it is encoded there.
 *
 * This map exists so the seeding helper is mechanical rather than transcribed. The goals work
 * (Q-241) wrote its nine `localStorage.setItem` calls out by hand, which is fine at nine and is
 * how a key gets seeded under the wrong name at twenty. `encoding` matters because these keys are
 * not uniform: `ta_ss_widgets` is JSON, `ta_weight_lookback` is a bare number, and the reminder
 * toggles are `String(boolean)` compared against the literal `'false'`.
 */
export const PREFERENCE_STORAGE: Readonly<Record<
  keyof UserPreferences,
  { key: string; encoding: 'json' | 'string' | 'number' | 'boolean' }
>> = Object.freeze({
  homeWidgets:        { key: 'ta_ss_widgets',            encoding: 'json' },
  homeCards:          { key: 'ta_ss_cards',              encoding: 'json' },
  homeSectionOrder:   { key: 'ta_home_section_order',    encoding: 'json' },
  homeHiddenSections: { key: 'ta_home_hidden_sections',  encoding: 'json' },
  pillColors:         { key: 'ta_pill_colors',           encoding: 'json' },
  cardColors:         { key: 'ta_card_colors',           encoding: 'json' },
  scoreRingStyle:     { key: 'ta_score_ring_style',      encoding: 'string' },
  weightLookback:     { key: 'ta_weight_lookback',       encoding: 'number' },
  goalsProgressView:  { key: 'ta_goals_progress_view',   encoding: 'string' },
  brandTheme:         { key: 'ta_brand_theme',           encoding: 'string' },
  brandHue:           { key: 'ta_brand_hue',             encoding: 'number' },
  backgroundSettings: { key: 'ta_background_settings',   encoding: 'json' },
  mealLabelStyle:     { key: 'ta_meal_label_style',      encoding: 'string' },
  restDurationSec:    { key: 'ta_rest_duration',         encoding: 'number' },
  foodRegion:         { key: 'ta_food_region',           encoding: 'string' },
  mealReminders:      { key: 'ta_pref_meal_reminders',      encoding: 'boolean' },
  healthAlerts:       { key: 'ta_pref_health_alerts',       encoding: 'boolean' },
  dayReviewReminders: { key: 'ta_pref_day_review_reminders', encoding: 'boolean' },
  calendarSync:       { key: 'ta_pref_calendar_sync',       encoding: 'boolean' },
})

export type UserPreferences = z.infer<typeof UserPreferencesSchema>

/**
 * Preferences that deliberately do NOT sync, and why. Listed rather than merely absent, because
 * "it didn't sync" and "it isn't meant to" look identical from a second device — Q-392 asked for
 * this list by name.
 *
 * A desktop browser inheriting a phone's notification state is its own bug, and the two chip
 * toggles drive Android status-bar chips that mean nothing outside the APK.
 */
export const DEVICE_LOCAL_PREFERENCES: Readonly<Record<string, string>> = Object.freeze({
  ta_pref_push_enabled: 'a permission grant on one device says nothing about another, and a desktop browser inheriting a phone\'s notification state is its own bug',
  ta_pref_rest_chip: 'drives an Android status-bar chip; meaningless outside the APK',
  ta_pref_run_chip: 'drives an Android status-bar chip; meaningless outside the APK',
  ta_ring_auto_capture: 'the ring is paired to one device over BLE; a second device cannot act on this',
  ta_ring_continuous_capture: 'the ring is paired to one device over BLE; a second device cannot act on this',
  ta_paired_hr_strap_v1: 'a BLE pairing belongs to the device that holds it',
  ta_paired_scale_v1: 'a BLE pairing belongs to the device that holds it',
  ta_scale_bg_sync_v1: 'background scale sync runs on the paired device only',
  theme: 'light/dark is owned by next-themes and defaults to the device\'s own setting — the taste choice that does sync is the brand theme and hue above',
})

/**
 * Merge a PATCH over the stored bag. **Merge, never replace** — two devices write independently,
 * and a device that only knows the keys it uses must not blank the ones it has never heard of.
 * An explicit `null` clears a key, so a client can say "forget this" without sending the whole bag.
 */
export function mergePreferences(
  stored: UserPreferences,
  patch: Record<string, unknown>,
): UserPreferences {
  const out: Record<string, unknown> = { ...stored }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else out[k] = v
  }
  return out as UserPreferences
}

/**
 * The PATCH body schema: every preference key, each additionally accepting `null` to clear it.
 * Derived from `UserPreferencesSchema` rather than written twice, so a key added above is
 * patchable the moment it exists.
 *
 * `.strict()` on both: an unknown key is a 400, not a silently persisted typo. A typo'd key in a
 * free-form bag is invisible forever — it stores fine, reads as absent, and the surface falls back
 * to its default while the server insists it saved.
 */
export const UserPreferencesPatchSchema = z.object(
  Object.fromEntries(
    Object.entries(UserPreferencesSchema.shape).map(([key, schema]) => [key, schema.nullable()]),
  ) as { [K in keyof typeof UserPreferencesSchema.shape]: z.ZodNullable<(typeof UserPreferencesSchema.shape)[K]> },
).strict()
