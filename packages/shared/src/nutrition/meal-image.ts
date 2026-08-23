/**
 * The size cap on a saved-meal thumbnail — which is the whole design (Q-396).
 *
 * A meal photo is stored as a base64 `data:` URI in `saved_meals.image_data_uri`, and that choice is
 * deliberate rather than lazy: the app is offline-first with no blob host, and a URL renders nothing
 * in airplane mode — which breaks the standing rule that a local table must hold everything needed
 * to render its row offline. A capped data URI is the only shape that survives the canonical runtime.
 *
 * **`users.avatar` is the visible precedent and it does NOT transfer.** It allows **5 MB**, and that
 * costs nothing because an avatar is one row per user and never enters the sync delta. A meal
 * thumbnail is one per saved meal and saved meals **sync** — every image rides the outbox push, the
 * pull delta and the on-device SQLite mirror, on a phone, forever. Copying 5 MB here would be the
 * largest single regression the sync engine has taken.
 *
 * **Nothing fails loudly if this slips.** The outbox gets slower, the local database grows, and the
 * first symptom is a sync timing out on a bad connection — which is why the number lives here, next
 * to the reasoning, rather than inline in a route. **Do not raise it without re-reading this.**
 */

/** 128 x 128 WebP lands around 6 KB; 16 KB is generous headroom, and 100 meals is then ~600 KB. */
export const SAVED_MEAL_IMAGE_MAX_BYTES = 16 * 1024

/** The formats a browser canvas can produce and every target can render. */
const ALLOWED_MIME = ['image/webp', 'image/jpeg', 'image/png']

export type MealImageRejection = 'not_a_data_uri' | 'unsupported_type' | 'too_large'

/**
 * Decoded size of a base64 data URI, without decoding it — base64 is 4 characters per 3 bytes.
 *
 * Exported because the picker shows this number on the tile (Q-327): the cap slipping is this
 * feature's whole risk and nothing fails loudly when it does — the outbox just gets slower — so a
 * figure the user can see is the cheapest tripwire there is. It has to be the **same** arithmetic
 * the server rejects on, or the tile would reassure about a number that is not the one being
 * checked. Returns 0 for an absent or malformed URI.
 */
export function mealImageBytes(dataUri: string | null | undefined): number {
  if (!dataUri) return 0
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUri)
  return match ? Math.ceil(match[2].length * 0.75) : 0
}

/**
 * Validate a thumbnail on the way in. Returns `null` when it is fine.
 *
 * **Server-side, always** — the client downscales before upload, but a client-side cap is not a cap.
 * `null`/empty is valid and means "no image", which is how a photo is removed.
 */
export function rejectMealImage(dataUri: string | null | undefined): MealImageRejection | null {
  if (!dataUri) return null

  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUri)
  if (!match) return 'not_a_data_uri'
  if (!ALLOWED_MIME.includes(match[1].toLowerCase())) return 'unsupported_type'
  if (mealImageBytes(dataUri) > SAVED_MEAL_IMAGE_MAX_BYTES) return 'too_large'
  return null
}

/** A sentence for the rejection, so every caller says the same thing. */
export function mealImageRejectionMessage(reason: MealImageRejection): string {
  switch (reason) {
    case 'not_a_data_uri':   return 'Image must be a base64 data URI'
    case 'unsupported_type': return 'Unsupported image type (use WebP, JPEG or PNG)'
    case 'too_large':        return `Image too large (max ${SAVED_MEAL_IMAGE_MAX_BYTES / 1024} KB — resize before saving)`
  }
}
