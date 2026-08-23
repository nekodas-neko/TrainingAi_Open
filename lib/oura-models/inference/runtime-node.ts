/**
 * The server `ModelRuntime` — `onnxruntime-node`, the native addon.
 *
 * Kept apart from `runtime.ts` so a port can import the interface without importing the addon;
 * that separation is the entire point of the port. The dynamic import keeps the addon out of any
 * accidental client/edge bundle, and `next.config.ts` marks it `serverExternalPackages`.
 */
import { getSession } from './session'
import type { ModelRuntime, ModelSession, ModelTensor } from './runtime'

const wrapped = new WeakMap<object, ModelSession>()

export const nodeModelRuntime: ModelRuntime = {
  async session(fileName: string): Promise<ModelSession | null> {
    const raw = await getSession(fileName)
    if (!raw) return null
    const hit = wrapped.get(raw)
    if (hit) return hit
    // `getSession` already resolved the addon to create this session, so the import is a cache hit.
    const ort = await import('onnxruntime-node')
    const session: ModelSession = {
      run: feeds => raw.run(feeds as Parameters<typeof raw.run>[0]) as Promise<Record<string, ModelTensor>>,
      float32: (data, dims) => new ort.Tensor('float32', data, dims),
    }
    wrapped.set(raw, session)
    return session
  },
}
