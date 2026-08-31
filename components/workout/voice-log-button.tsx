"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicIcon, MicOffIcon } from "lucide-react";
import { VOICE_LOG_EXAMPLE, parseVoice } from "./utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any

function getSR(): AnySpeechRecognition | undefined {
  if (typeof window === 'undefined') return undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
}

// Guarded dynamic import, same shape as every other native module in this app: a browser (or an
// older APK built before the plugin existed) resolves to null and falls through to the web path.
//
// **Returns `{ plugin }`, never the plugin itself** — the same wrapper, for the same reason,
// as `getOuraBle()` in `lib/oura-ble/plugin.ts`, which documents it in full. `registerPlugin()`
// hands back a Proxy whose `get` trap answers EVERY property with a callable, `then` included, so
// resolving this async function's promise with it makes the promise-resolution algorithm read
// `.then`, find a function, treat the proxy as a thenable and invoke `SpeechRecognition.then()`
// across the bridge. **The result is a HANG, not a rejection** — Capacitor's wrapper ignores the
// `resolve`/`reject` it was handed and returns a rejected promise instead, so nothing ever settles
// this one and the bridge error escapes as an unhandled rejection. The `catch` here cannot see it
// either way: the body has already returned.
//
// This shipped, and production `error_events` reported the escaped error verbatim on 2026-08-30:
// `"SpeechRecognition.then()" is not implemented on android`. Because this function never settled,
// the availability effect never continued, `available` stayed `null`, and **the Voice button did
// not render on the APK at all**. The four locally-registered plugins all wrap; this one did not, because its plugin comes
// from a community package and so a grep for `registerPlugin` never reached the file.
// `scripts/check-plugin-proxy-thenable.js` now looks for the shape rather than the call.
async function getNativeSpeech(): Promise<{ plugin: AnySpeechRecognition } | null> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
    return { plugin: SpeechRecognition }
  } catch { return null }
}

/**
 * Voice set-logging.
 *
 * The APK is the canonical target and it never worked there. An embedded `android.webkit.WebView`
 * has no bundled continuous recognition service, so `webkitSpeechRecognition` exists on the object
 * but produces no transcript — and `RECORD_AUDIO` was not declared in the manifest at all, so
 * Capacitor's runtime request for it failed silently and `onerror` fired in the same tick. That is
 * the "press it and it turns off straight away" symptom.
 *
 * Native now goes through Android's own `SpeechRecognizer` via the Capacitor plugin. The Web Speech
 * API path is unchanged and stays logic-free — it exists so `pnpm dev` renders, per the Canonical
 * Runtime rule, and must never grow behaviour the device path lacks. Both sources feed the same
 * `parseVoice`, so only the raw transcript differs.
 */
export function VoiceLogButton({ onResult }: { onResult: (weight?: number, reps?: number) => void }) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // null = not resolved yet. Resolved in an effect rather than during render: a cache/window read
  // in a render body is the hydration-mismatch shape this project has been bitten by before.
  const [available, setAvailable] = useState<'native' | 'web' | null>(null)
  const recRef = useRef<AnySpeechRecognition>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const native = await getNativeSpeech()
      if (cancelled) return
      if (native) { setAvailable('native'); return }
      if (getSR()) setAvailable('web')
    })()
    return () => { cancelled = true }
  }, [])

  const runNative = useCallback(async () => {
    setError(null)
    try {
      const native = await getNativeSpeech()
      if (!native) return
      const { plugin } = native
      if (listening) {
        await plugin.stop().catch(() => {})
        setListening(false)
        return
      }
      const perm = await plugin.requestPermissions()
      if (perm.speechRecognition !== 'granted') {
        // Fail visibly. The old behaviour — flip straight back to "Voice" with no explanation — is
        // indistinguishable from the bug this replaces.
        setError('Microphone permission denied')
        return
      }
      const { available: ok } = await plugin.available()
      if (!ok) { setError('Speech recognition unavailable on this device'); return }

      setListening(true)
      const res = await plugin.start({
        language: 'en-US',
        maxResults: 1,
        partialResults: false,
        popup: false,
      })
      const transcript = res.matches?.[0]
      if (!transcript) { setError('Did not catch that'); return }
      const { weight, reps } = parseVoice(transcript)
      // Naming the transcript alone read as the app disagreeing with the user's ears — the report
      // that produced BF-66 was a *correct* transcript the parser then threw away. Say what failed
      // and what to say instead.
      if (weight === undefined && reps === undefined) {
        setError(`Didn't understand "${transcript}" — try "${VOICE_LOG_EXAMPLE}"`)
        return
      }
      onResult(weight, reps)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Voice logging failed')
    } finally {
      setListening(false)
    }
  }, [listening, onResult])

  const runWeb = useCallback(() => {
    const SR = getSR()
    if (!SR) return

    if (listening) {
      recRef.current?.stop()
      setListening(false)
      return
    }

    const rec = new SR()
    recRef.current = rec
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1

    rec.onresult = (e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => {
      const transcript = e.results[0][0].transcript
      const { weight, reps } = parseVoice(transcript)
      onResult(weight, reps)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)

    rec.start()
    setListening(true)
  }, [listening, onResult])

  const toggle = useCallback(() => {
    if (available === 'native') void runNative()
    else runWeb()
  }, [available, runNative, runWeb])

  if (available === null) return null

  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        onClick={toggle}
        aria-label={listening ? 'Stop listening' : 'Log by voice'}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors"
        style={{
          background: listening
            ? 'color-mix(in oklch, var(--color-brand) 20%, transparent)'
            : 'color-mix(in oklch, var(--color-brand) 10%, transparent)',
          color: 'var(--color-brand)',
          border: `1px solid color-mix(in oklch, var(--color-brand) ${listening ? '40%' : '20%'}, transparent)`,
        }}
      >
        {listening ? <MicOffIcon className="w-3.5 h-3.5" /> : <MicIcon className="w-3.5 h-3.5" />}
        {listening ? 'Listening…' : 'Voice'}
      </button>
      {/* The accepted phrasing was learnable only by failing at it — nothing on the button, no
          hint, no first-run text. One example, always on the line the error uses, so the layout
          does not shift when a parse fails. */}
      {error
        ? <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p>
        : <p className="text-[10px] text-muted-foreground">{listening ? 'Say the weight and reps' : `Say "${VOICE_LOG_EXAMPLE}"`}</p>}
    </div>
  )
}
