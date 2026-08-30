// Why every native-plugin getter in this app returns `{ plugin }` and never the plugin.
//
// `lib/oura-ble/plugin.ts` has explained this in prose since it was written, and prose did not stop
// `components/workout/voice-log-button.tsx` walking into it: production `error_events` reported
// `"SpeechRecognition.then()" is not implemented on android` on 2026-08-30, and the Voice button
// never rendered on the APK at all.
//
// The invariant is executable here, and `scripts/check-plugin-proxy-thenable.js` enforces the shape
// in CI. This file exists for the half a grep cannot show: *why* the wrapper is not ceremony.
//
// **The failure is a HANG, not a rejection** — which is the detail that makes it so hard to spot,
// and the detail this test was written to pin down after a first draft asserted a rejection and was
// proved wrong. The promise-resolution algorithm reads `.then`, gets a callable, and invokes it with
// its own `resolve`/`reject`. Capacitor's wrapper ignores both and RETURNS a rejected promise
// instead — so nothing ever settles the outer promise, and the bridge error escapes as an unhandled
// rejection. That is exactly how it reached `error_events` with source `client` while the awaiting
// effect simply never continued.
//
// The proxy below reproduces `registerPlugin()`'s `get` trap from
// `node_modules/@capacitor/core/dist/index.cjs.js` — `$$typeof`, `toJSON`, `addListener` and
// `removeListener` are special-cased and **everything else**, `then` included, becomes a callable
// that dispatches across the bridge.
import { describe, it, expect } from 'vitest'

/** Errors the fake bridge produced. In production these are the unhandled rejections. */
const bridgeErrors: Error[] = []

/** Stand-in for a plugin the native bridge exposes with a fixed set of methods. */
function makePluginProxy(pluginName: string, nativeMethods: string[]) {
  return new Proxy({} as Record<string, unknown>, {
    get(_, prop) {
      switch (prop) {
        case '$$typeof': return undefined
        case 'toJSON': return () => ({})
        default:
          return (...args: unknown[]) => {
            if (nativeMethods.includes(String(prop))) return Promise.resolve({ called: String(prop), args })
            const err = new Error(`"${pluginName}.${String(prop)}()" is not implemented on android`)
            bridgeErrors.push(err)
            const rejected = Promise.reject(err)
            // Capacitor returns this rejected promise and never calls the resolve/reject it was
            // handed — the hang. Attaching a handler to our own copy keeps the runner quiet without
            // changing that: the outer promise is still never settled, which is what is asserted.
            rejected.catch(() => {})
            return rejected
          }
      }
    },
  })
}

const SpeechRecognition = makePluginProxy('SpeechRecognition', ['start', 'stop', 'available', 'requestPermissions'])

/** Resolves to 'pending' if `p` has not settled within `ms`. */
const settlesWithin = (p: Promise<unknown>, ms: number) =>
  Promise.race([
    p.then(() => 'settled' as const, () => 'settled' as const),
    new Promise<'pending'>(r => setTimeout(() => r('pending'), ms)),
  ])

describe('a registerPlugin() proxy is thenable, and that is the whole problem', () => {
  it('manufactures a callable for `then`, which is what makes it look like a promise', () => {
    expect(typeof (SpeechRecognition as unknown as { then: unknown }).then).toBe('function')
  })

  it('HANGS when an async function returns it bare, and leaks the bridge error — the shipped bug', async () => {
    bridgeErrors.length = 0

    // The exact shape that was in voice-log-button.tsx. The try/catch cannot help: `then` is
    // invoked while the returned promise is being RESOLVED, after the body has finished.
    async function getNativeSpeechBroken() {
      try {
        return SpeechRecognition
      } catch {
        return null
      }
    }

    // Never settles — so `await getNativeSpeech()` in an effect never continues, `available` stays
    // null, and the button does not render.
    expect(await settlesWithin(getNativeSpeechBroken(), 50)).toBe('pending')

    // …while the bridge error escapes with nobody to catch it. This is the production log line.
    expect(bridgeErrors.map(e => e.message)).toContain(
      '"SpeechRecognition.then()" is not implemented on android',
    )
  })

  it('resolves when the same proxy is wrapped in a plain object — the fix', async () => {
    bridgeErrors.length = 0

    async function getNativeSpeech() {
      try {
        return { plugin: SpeechRecognition }
      } catch {
        return null
      }
    }

    const native = await getNativeSpeech()
    expect(native).not.toBeNull()
    await expect(native!.plugin.start({ language: 'en-US' })).resolves.toMatchObject({ called: 'start' })
    // Nothing touched `then`, so the bridge was never asked for a method it does not have.
    expect(bridgeErrors).toHaveLength(0)
  })
})

describe('the hazard is the proxy, not the plugin', () => {
  // `lib/colmi-ble/ble.ts` and `lib/live-hr/chest-strap-source.ts` both do `return BleClient` from an
  // async function and are CORRECT, because @capacitor-community/bluetooth-le exports
  // `BleClient = new BleClientClass()` — a plain instance, not a proxy. A rule that banned
  // "returning a plugin" would have flagged two working call sites; the rule is about the proxy.
  class BleClientClass {
    async initialize() { return 'ok' as const }
  }
  const BleClient = new BleClientClass()

  it('a plain instance has no `then`, so returning it from an async function is fine', async () => {
    expect((BleClient as unknown as { then?: unknown }).then).toBeUndefined()

    async function getBle() {
      try {
        return BleClient
      } catch {
        return null
      }
    }

    expect(await settlesWithin(getBle(), 50)).toBe('settled')
    await expect((await getBle())!.initialize()).resolves.toBe('ok')
  })
})
