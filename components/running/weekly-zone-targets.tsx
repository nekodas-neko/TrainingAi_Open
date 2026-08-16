'use client'

import { HR_ZONE_META } from '@trainingai/shared/health/hr-zones'
import type { WeeklyZoneTargets } from '@trainingai/shared/running/zone-targets'

// This-week HR-zone time targets for the active plan's goal — how many minutes should
// land in each zone. Read straight off the engine's weeklyZoneTargets (no re-derivation).
export function WeeklyZoneTargetsCard({ zoneTargets, goalLabel }: { zoneTargets: WeeklyZoneTargets; goalLabel?: string }) {
  const max = Math.max(1, ...zoneTargets.perZone.map((z) => z.minutes))
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-[color:var(--muted-foreground)]">
          This week&rsquo;s zones{goalLabel ? ` · ${goalLabel}` : ''}
        </h3>
        <span className="ml-auto text-[10px] text-[color:var(--muted-foreground)] tabular-nums">
          {zoneTargets.totalMinutes} min
        </span>
      </div>

      <ul className="space-y-1.5">
        {zoneTargets.perZone.filter((z) => z.minutes > 0).map((z) => {
          const meta = HR_ZONE_META.find((m) => m.id === z.zoneId)
          return (
            <li key={z.zoneId} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[11px] text-[color:var(--muted-foreground)]">
                Z{z.zoneId} {meta?.name}
              </span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: 'color-mix(in oklch, var(--muted) 40%, transparent)' }}>
                <span className="block h-full rounded-full" style={{ width: `${(z.minutes / max) * 100}%`, background: meta?.color ?? 'var(--accent-cyan)' }} />
              </span>
              <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-[color:var(--foreground)]">{z.minutes}m</span>
            </li>
          )
        })}
      </ul>

      <p className="mt-3 border-t pt-2 text-[11px] leading-snug text-[color:var(--muted-foreground)]" style={{ borderColor: 'var(--border)' }}>
        {zoneTargets.guidelineNote} ~{Math.round(zoneTargets.easyShare * 100)}% easy / {Math.round(zoneTargets.hardShare * 100)}% hard.
      </p>
    </div>
  )
}
