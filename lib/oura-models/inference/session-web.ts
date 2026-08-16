/**
 * onnxruntime-web (WASM) inference sessions for the on-device neural rollup.
 *
 * The WebView sibling of `session.ts` (which uses the server-only onnxruntime-node native
 * addon). Models are provided as bytes by the caller — in the WebView they are fetched from
 * Railway-served assets and cached by the service worker; in tests they are read from disk.
 * Each session is created once and cached by key.
 *
 * Byte-parity with the onnxruntime-node path is guarded by `wasm-parity.test.ts`: SleepNet
 * per-epoch stage argmax matches exactly and the continuous heads agree to ~1e-6.
 */
import type { InferenceSession } from 'onnxruntime-web'

const sessionCache = new Map<string, Promise<InferenceSession | null>>()

/**
 * Get (or lazily create) a cached WASM inference session, keyed by name. `loadBytes` is called
 * only on a cache miss. Returns `null` on any failure — callers must fall back to the heuristic
 * path, never throw (mirrors the onnxruntime-node loader's contract).
 */
export function getWebSession(
  key: string,
  loadBytes: () => Promise<Uint8Array>,
): Promise<InferenceSession | null> {
  const existing = sessionCache.get(key)
  if (existing) return existing
  const created = createWebSession(loadBytes)
  sessionCache.set(key, created)
  return created
}

async function createWebSession(loadBytes: () => Promise<Uint8Array>): Promise<InferenceSession | null> {
  try {
    const ort = await import('onnxruntime-web')
    const bytes = await loadBytes()
    return await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
  } catch (err) {
    console.warn('[oura-models/web] failed to load WASM session:', err)
    return null
  }
}

/** Test-only: clear the session cache so a fresh session is created next call. */
export function __clearWebSessionCache() {
  sessionCache.clear()
}
