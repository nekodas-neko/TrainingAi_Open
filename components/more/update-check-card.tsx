"use client"

import { useEffect, useState } from "react"
import { RefreshCw, CheckCircle2 } from "lucide-react"
import { resolveUpdateState } from "@trainingai/shared/version-check"
import { useTabVisibility } from "@/components/shell/tab-visibility"

// Native-only: web/PWA already gets updates via the service worker (sw.js).
// A capacitor-guarded dynamic import keeps @capacitor/app out of the web bundle.
//
// The comparison is against `nativeVersion` — the version of the newest published APK — NOT the
// server's current version. The APK is a WebView loading Railway, so nearly every release arrives
// with no reinstall; comparing against the server version lit this card up permanently, telling the
// owner to reinstall for changes their device already had.
//
// Three states, deliberately. "Could not check" is not "up to date": on a failed lookup the card
// renders the neutral row rather than claiming either way, because a false all-clear is the same
// class of mistake as a false alarm.
type State =
  | { kind: "update"; nativeVersion: string }
  | { kind: "current"; nativeVersion: string }
  | { kind: "unknown" }

export function UpdateCheckCard() {
  const [state, setState] = useState<State | null>(null)
  // Re-check on every re-show, not once per app launch. A build published while the app sat open
  // is exactly the case this card exists for, and the tab never unmounts to re-run the effect.
  const { epoch } = useTabVisibility()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { Capacitor } = await import("@capacitor/core")
      if (!Capacitor.isNativePlatform()) return

      const { App } = await import("@capacitor/app")
      const [info, res] = await Promise.all([
        App.getInfo(),
        fetch("/api/version").then(r => r.json()).catch(() => null),
      ])
      if (cancelled) return

      const nativeVersion: string | null = res?.nativeVersion ?? null
      const kind = resolveUpdateState(info.version, nativeVersion)
      setState(kind === "unknown" ? { kind } : { kind, nativeVersion: nativeVersion! })
    })()
    return () => { cancelled = true }
  }, [epoch])

  if (!state) return null

  if (state.kind === "update") {
    return (
      <a
        href="/api/download-apk"
        className="flex items-center justify-between px-4 py-3 transition"
        style={{ background: "color-mix(in oklch, var(--accent-amber) 10%, transparent)" }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "color-mix(in oklch, var(--accent-amber) 15%, transparent)" }}>
            <RefreshCw className="h-4 w-4" style={{ color: "var(--accent-amber)" }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--accent-amber)" }}>New app build available — v{state.nativeVersion}</p>
            <p className="text-[10px] text-muted-foreground">Tap to download the latest APK</p>
          </div>
        </div>
      </a>
    )
  }

  return (
    <div className="px-4 py-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        App build
      </p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {state.kind === "current" ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--accent-green)" }} />
            Up to date — v{state.nativeVersion} is the newest build
          </>
        ) : (
          "Could not check for a newer build"
        )}
      </p>
    </div>
  )
}
