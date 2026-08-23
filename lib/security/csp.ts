/**
 * The app's Content-Security-Policy, in one place so it can be asserted on.
 *
 * It lived inline in `next.config.ts`, where nothing could import it and so nothing tested it —
 * and the directive that was missing (Q-546) was invisible for exactly that reason: the WASM
 * parity test runs under Node, which has no CSP at all, so it false-greened while no WASM session
 * could start in the browser.
 */
export function buildCsp(isDev: boolean): string {
  return [
  "default-src 'self'",
  // 'unsafe-inline': Next.js App Router emits inline bootstrap/Flight scripts
  // and we have no middleware to attach nonces (follow-up). 'unsafe-eval' is
  // dev-only — Turbopack/React Refresh need eval for HMR; production does not.
  //
  // 'wasm-unsafe-eval' (Q-546) permits WebAssembly compilation and NOTHING else — it is
  // deliberately narrower than 'unsafe-eval', which it does not imply and is not implied by in
  // production. Without it no WASM session can start in the browser, which blocks every on-device
  // model (`onnxruntime-web` is already a dependency, with a parity test). It is unconditional
  // rather than production-only so dev and production agree about WASM specifically; dev's
  // 'unsafe-eval' already covers WASM, so this changes nothing there.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''} https://accounts.google.com`,
  // 'unsafe-inline' styles: motion/Radix/next-themes set inline style
  // attributes (Tailwind itself is a compiled stylesheet and doesn't need it).
  "style-src 'self' 'unsafe-inline'",
  // raw.githubusercontent.com: the exercise dataset's GIFs and stills, rendered as plain <img src>
  // by exercise-stats-sheet.tsx and written into exercise_library by seed-exercise-gifs. The host
  // was in images.remotePatterns below but in neither directive here, so every exercise without an
  // S3 GIF (getThumbnail's same-origin proxy path) showed nothing at all.
  "img-src 'self' data: blob: https://raw.githubusercontent.com https://*.tile.openstreetmap.org https://*.tile.thunderforest.com https://lh3.googleusercontent.com https://lh4.googleusercontent.com https://lh5.googleusercontent.com https://lh6.googleusercontent.com",
  "font-src 'self'",
  // Tile domains: the service worker's fetch handler re-issues fetch() for every request
  // (including cross-origin tile <img> loads) to populate its cache — a fetch() call made
  // from inside a service worker is governed by connect-src, not img-src, regardless of the
  // resource type. img-src alone (above) covers a direct <img> load but not the SW's own
  // re-fetch of that same request, so both must be listed here too or the SW's fetch is
  // silently CSP-blocked and every tile request fails.
  // raw.githubusercontent.com is here for the same reason the tile domains are — the SW's re-fetch,
  // not the <img> itself. Listing it only in img-src reproduces the exact bug this comment
  // describes, one host later.
  // The two Oura Cloud hosts that used to sit between oauth2.googleapis.com and open-meteo were
  // removed here on 2026-08-20. The integration itself went on 2026-08-13, and
  // `lib/oura/__tests__/no-cloud-calls.test.ts` already proves no source file calls them — but that
  // guard sweeps `app/`, `components/`, `lib/` and `packages/shared/src`, and the CSP was living in
  // `next.config.ts` at the repo root, where nothing looked. So the header kept permitting outbound
  // connections to an integration that no longer exists. Extracting this file is what surfaced it.
  "connect-src 'self' https://generativelanguage.googleapis.com https://accounts.google.com https://oauth2.googleapis.com https://api.open-meteo.com https://geocoding-api.open-meteo.com https://raw.githubusercontent.com https://*.tile.openstreetmap.org https://*.tile.thunderforest.com wss: ws:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
].join('; ')
}
