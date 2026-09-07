"use client"

import { ChevronRight, Download } from 'lucide-react'
import { CHANGELOG, CURRENT_VERSION } from '@trainingai/shared/changelog'
import { UpdateCheckCard } from '@/components/more/update-check-card'
import { ServiceWorkerStatusRow } from '@/components/more/sw-status-row'

/** Version · update check · service-worker status · APK download · what's new.
 *  Sync/Restore/Export used to share this block; they are DataSyncPanel now (Q-232). */
export function AboutPanel() {
  return (
    <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden divide-y divide-border">
      <div className="px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">TrainingAI</p>
          <p className="text-xs text-muted-foreground mt-0.5">Personal gym tracker — powered by AI</p>
          {/* BF-111: this number and the Android build below are different things and both are
              right. The app updates itself on every deploy; the APK only changes on a rebuild. */}
          <p className="text-[10px] text-muted-foreground mt-0.5">Updates automatically — no reinstall needed</p>
        </div>
        <span
          className="text-xs font-mono font-bold px-2 py-1 rounded-lg"
          style={{ background: 'color-mix(in oklch, var(--color-brand) 15%, transparent)', color: 'var(--color-brand)' }}
        >
          App v{CURRENT_VERSION}
        </span>
      </div>
      <UpdateCheckCard />
      <ServiceWorkerStatusRow />
      <a
        href="/api/download-apk"
        className="flex items-center justify-between px-4 py-3 hover:bg-muted/60 transition"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'color-mix(in oklab, var(--color-brand) 15%, var(--color-muted))' }}>
            <Download className="h-4 w-4" style={{ color: 'var(--color-brand)' }} />
          </div>
          <div>
            <p className="text-sm font-semibold">Download Android App</p>
            <p className="text-[10px] text-muted-foreground">Latest APK from GitHub releases</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </a>
      <div className="px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          What&apos;s new in v{CHANGELOG[0].version}
        </p>
        <ul className="space-y-1">
          {CHANGELOG[0].changes.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="mt-0.5 flex-none" style={{ color: "var(--color-brand)" }}>·</span>
              {c}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
