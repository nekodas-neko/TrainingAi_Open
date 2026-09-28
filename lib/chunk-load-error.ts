/**
 * Is this the browser failing to fetch a JavaScript chunk, rather than the app being wrong?
 *
 * **Why it earns its own module:** the answer decides whether the root error boundary retries
 * automatically, and the strings come from three different producers — webpack/Turbopack
 * (`Loading chunk 42 failed`, `ChunkLoadError`), Next's `next/dynamic` async loader
 * (`Failed to load chunk … (ecmascript, next/dynamic entry, async loader)`) and the native ESM
 * loader (`error loading dynamically imported module`). Matching them is a small pure function, so
 * it is testable by calling it rather than by provoking a real chunk failure in a browser.
 *
 * Kept deliberately narrow. A false positive costs a silent reload of a screen that was genuinely
 * broken, which hides a real defect — so anything that is not unmistakably a transport failure is
 * left to the boundary's normal path.
 */
const CHUNK_LOAD_PATTERNS: readonly RegExp[] = [
  /ChunkLoadError/i,
  /Loading chunk [^\s]+ failed/i,
  /Failed to load chunk/i,
  /error loading dynamically imported module/i,
  /Loading CSS chunk [^\s]+ failed/i,
]

export function isChunkLoadError(error: { name?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const haystack = `${error.name ?? ''} ${error.message ?? ''}`
  return CHUNK_LOAD_PATTERNS.some(p => p.test(haystack))
}
