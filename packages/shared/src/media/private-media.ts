/**
 * Everything under `/exercise-media/` is served by our own proxy so the bucket can stay private,
 * and `middleware.ts` puts that path behind the session gate like any other non-`/api` route.
 *
 * Next's image optimizer fetches a source URL **server-side**, without the viewer's cookie. So the
 * optimizer is redirected to `/sign-in`, receives HTML where an image should be, and answers 400 —
 * which the browser renders as a broken image. It fails before storage is ever consulted, so it is
 * independent of what is stored under the key.
 *
 * Measured against `pnpm dev`, 2026-09-24 (DV-18):
 *
 *     GET /exercise-media/reference-figure.png                 -> 307 /sign-in
 *     GET /_next/image?url=%2Fexercise-media%2F…&w=96&q=75     -> 400 "isn't a valid image"
 */
export const PRIVATE_MEDIA_PREFIX = '/exercise-media/'

/**
 * Whether an `<Image>` src has to set `unoptimized`.
 *
 * Call sites already excluded GIFs one at a time, because the optimizer serves a still frame of an
 * animation. That rule is folded in here so a single predicate answers the whole question: the
 * previous shape, `unoptimized={src.endsWith('.gif')}` repeated at six call sites, is what let
 * every non-GIF private media URL through to the optimizer and broke it.
 */
export function mustBypassImageOptimizer(src: string): boolean {
  return src.startsWith(PRIVATE_MEDIA_PREFIX) || src.endsWith('.gif')
}
