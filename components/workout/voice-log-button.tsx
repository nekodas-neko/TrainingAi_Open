"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicIcon, MicOffIcon } from "lucide-react";
import { parseVoice } from "./utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any

function getSR(): AnySpeechRecognition | undefined {
  if (typeof window === 'undefined') return undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
}

// Guarded dynamic import, same shape as every other native module in this app: a browser (or an
// older APK built before the plugin existed) resolves to null and falls through to the web path.
async function getNativeSpeech() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
    return SpeechRecognition
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
    const native = await getNativeSpeech()
    if (!native) return
    if (listening) {
      await native.stop().catch(() => {})
      setListening(false)
      return
    }
    setError(null)
    try {
      const perm = await native.requestPermissions()
      if (perm.speechRecognition !== 'granted') {
        // Fail visibly. The old behaviour — flip straight back to "Voice" with no explanation — is
        // indistinguishable from the bug this replaces.
        setError('Microphone permission denied')
        return
      }
      const { available: ok } = await native.available()
      if (!ok) { setError('Speech recognition unavailable on this device'); return }

      setListening(true)
      const res = await native.start({
        language: 'en-US',
        maxResults: 1,
        partialResults: false,
        popup: false,
      })
      const transcript = res.matches?.[0]
      if (!transcript) { setError('Did not catch that'); return }
      const { weight, reps } = parseVoice(transcript)
      if (weight === undefined && reps === undefined) { setError(`Heard "${transcript}"`); return }
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
    <div className="flex flex-col items-start gap-0.5">
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
      {error && <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
