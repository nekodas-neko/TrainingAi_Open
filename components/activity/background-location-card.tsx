"use client"

import { useEffect, useState } from "react"
import { MapPin, MapPinOff, ChevronRight, TriangleAlert } from "lucide-react"
import { Capacitor } from "@capacitor/core"
import { useAutoDetectionStore } from "@/lib/stores/auto-detection-store"
import {
  isBackgroundLocationCheckAvailable,
  isBackgroundLocationGranted,
  openLocationSettings,
} from "@/lib/activity/location-permission"

// Passive walk/run auto-detection needs Android's "Allow all the time" location
// grant — the background-geolocation watcher only ever requests foreground
// access, so without this the feature silently never sees a moving GPS fix.
// Shown only on native where the check is possible; re-checks on focus/visibility
// so returning from the settings page updates the status without a reload.
function formatDiag(diag: NonNullable<ReturnType<typeof useAutoDetectionStore.getState>['detectionDiag']>): string {
  const gpsPart = diag.gpsSinceMs === null
    ? 'GPS off'
    : `GPS on ${Math.round((Date.now() - diag.gpsSinceMs) / 60000)}m`
  const lastFixPart = diag.lastPointMs === null
    ? 'no fix yet'
    : `last fix ${Math.round((Date.now() - diag.lastPointMs) / 1000)}s ago`
  return `Detection: ${diag.gateState} · ${gpsPart} · ${lastFixPart} · trigger: ${diag.trigger}`
}

export function BackgroundLocationCard() {
  const [available, setAvailable] = useState(false)
  const [granted, setGranted] = useState(true)
  const detectionError = useAutoDetectionStore(s => s.detectionError)
  const detectionDiag = useAutoDetectionStore(s => s.detectionDiag)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    function check() {
      if (!isBackgroundLocationCheckAvailable()) return
      setAvailable(true)
      setGranted(isBackgroundLocationGranted())
    }

    check()
    document.addEventListener("visibilitychange", check)
    window.addEventListener("focus", check)
    return () => {
      document.removeEventListener("visibilitychange", check)
      window.removeEventListener("focus", check)
    }
  }, [])

  if (!available) return null

  const ok = granted && !detectionError

  if (ok) {
    return (
      <div>
        <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Activity Detection
        </p>
        <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden flex items-center gap-3 px-4 py-3.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "color-mix(in oklab, var(--color-brand) 15%, var(--color-muted))" }}
          >
            <MapPin className="h-4 w-4" style={{ color: "var(--color-brand)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Background walk detection</p>
            <p className="text-[10px] text-muted-foreground">Enabled — works even when the app is closed</p>
            {detectionDiag && (
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">{formatDiag(detectionDiag)}</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  const title = !granted ? "Location permission needed" : "Walk detection isn't working"
  const detail = !granted
    ? 'Set location access to "Allow all the time" so walks are detected even when the app is closed'
    : (detectionError ?? "Location watcher reported an error")

  return (
    <div>
      <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Activity Detection
      </p>
      <button
        type="button"
        onClick={openLocationSettings}
        className="w-full rounded-2xl bg-muted/40 border border-amber-500/30 overflow-hidden flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/60 transition"
      >
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-500/15">
          {!granted
            ? <MapPinOff className="h-4 w-4 text-amber-500" />
            : <TriangleAlert className="h-4 w-4 text-amber-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-[10px] text-muted-foreground truncate">{detail}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </button>
    </div>
  )
}
