"use client"

import { useEffect, useState } from "react"
import { RefreshCw, CheckCircle2 } from "lucide-react"
import { resolveUpdateState } from "@trainingai/shared/version-check"
import { useTabVisibility } from "@/components/shell/tab-visibility"
import { useUserTimezone } from "@/components/shell/user-timezone-provider"
import { formatBuildDate } from "@/components/more/build-label"

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
//
// BF-111: every state names the INSTALLED build, and the header says "Android build" rather than
// "App build". The About panel's chip is the web version and moves with every Railway deploy; this
// is the APK and moves only on a rebuild. Both numbers were right and neither said what it governed,
// so a green tick appeared to vouch for the smaller one.
type State =
  | { kind: "update"; nativeVersion: string; installedVersion: string; builtAt: string | null }
  | { kind: "current"; nativeVersion: string; installedVersion: string; builtAt: string | null }
  | { kind: "unknown"; installedVersion: string }

export function UpdateCheckCard() {
  const [state, setState] = useState<State | null>(null)
  const tz = useUserTimezone()
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
      setState(kind === "unknown"
        ? { kind, installedVersion: info.version }
        : { kind, nativeVersion: nativeVersion!, installedVersion: info.version, builtAt: res?.nativeBuiltAt ?? null })
    })()
    return () => { cancelled = true }
  }, [epoch])

  if (!state) return null

  if (state.kind === "update") {
    const built = formatBuildDate(state.builtAt, tz)
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
            <p className="text-sm font-semibold" style={{ color: "var(--accent-amber)" }}>
              New Android build — v{state.nativeVersion}{built ? ` (${built})` : ""}
            </p>
            {/* The installed version is the half that answers "do I have that native fix yet?".
                Without it the card names a build the phone does not have and says nothing about
                the one it does. */}
            <p className="text-[10px] text-muted-foreground">
              You have v{state.installedVersion} — tap to download
            </p>
          </div>
        </div>
      </a>
    )
  }

  const built = state.kind === "current" ? formatBuildDate(state.builtAt, tz) : null
  return (
    <div className="px-4 py-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Android build
      </p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {state.kind === "current" ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--accent-green)" }} />
            Up to date — v{state.installedVersion}{built ? `, built ${built}` : ""}
          </>
        ) : (
          <>Could not check for a newer build — you have v{state.installedVersion}</>
        )}
      </p>
    </div>
  )
}
