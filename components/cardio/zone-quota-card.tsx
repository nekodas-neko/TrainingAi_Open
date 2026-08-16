'use client'

import { memo, useState } from 'react'
import { HR_ZONE_META } from '@trainingai/shared/health/hr-zones'
import type { ZoneQuota, ZoneQuotaRow } from '@trainingai/shared/health/zone-quota'

interface Props {
  dayQuota: ZoneQuota
  weekQuota: ZoneQuota
  goalLabel?: string
}

/** Zone 1 fills from ordinary daily movement, so it renders as context rather than a
 *  target (spec D-10) — showing it as an open goal would overstate the training week. */
const PASSIVE_ZONE_ID = 1

function ZoneRow({ row }: { row: ZoneQuotaRow }) {
  const meta = HR_ZONE_META.find((m) => m.id === row.zoneId)
  const notRequired = row.status === 'not-required'

  return (
    <li className={notRequired ? 'opacity-45' : undefined}>
      <div className="flex items-baseline gap-1.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta?.color }} aria-hidden />
          Z{row.zoneId} {meta?.name}
        </span>
        <span className="ml-auto font-mono text-xs tabular-nums">
          {notRequired ? (
            <span className="text-[color:var(--muted-foreground)]">not needed</span>
          ) : (
            <>
              <b className={row.status === 'complete' ? 'text-[color:var(--accent-green)]' : undefined}>{row.doneMin}</b>
              <span className="text-[color:var(--muted-foreground)]"> / {row.targetMin} min</span>
            </>
          )}
        </span>
      </div>

      {/* The track must set display:flex (or the fill must be display:block) — an inline
          element inside a track without either ignores width/height and renders invisibly.
          This exact bug shipped in the design mockup; do not regress it. */}
      <div
        className="mt-1 flex h-3.5 overflow-hidden rounded-full"
        style={{ background: 'color-mix(in oklch, var(--muted-foreground) 24%, transparent)' }}
        role="progressbar"
        aria-valuenow={row.pctComplete}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Zone ${row.zoneId} ${meta?.name}`}
      >
        {!notRequired && (
          <span className="block h-full rounded-full" style={{ width: `${row.pctComplete}%`, background: meta?.color }} />
        )}
      </div>

      {!notRequired && (
        <div className="mt-0.5 flex justify-between font-mono text-[10px] tabular-nums text-[color:var(--muted-foreground)]">
          <span>{row.pctComplete}% done</span>
          <span>{row.remainingMin === 0 ? 'complete' : `${row.remainingMin} min left`}</span>
        </div>
      )}
    </li>
  )
}

function ZoneQuotaCardImpl({ dayQuota, weekQuota, goalLabel }: Props) {
  const [view, setView] = useState<'day' | 'week'>('day')
  const quota = view === 'day' ? dayQuota : weekQuota
  const training = quota.zones.filter((z) => z.zoneId !== PASSIVE_ZONE_ID)
  const passive = quota.zones.find((z) => z.zoneId === PASSIVE_ZONE_ID)
  const passiveMeta = HR_ZONE_META.find((m) => m.id === PASSIVE_ZONE_ID)

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <div className="flex gap-1.5 font-mono text-[10px] uppercase tracking-widest">
          {(['day', 'week'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className="rounded-full border px-2 py-0.5 transition"
              style={{
                borderColor: view === v ? 'var(--accent-cyan)' : 'var(--border)',
                color: view === v ? 'var(--accent-cyan)' : 'var(--muted-foreground)',
              }}
            >
              {v === 'day' ? 'Today' : 'This week'}
            </button>
          ))}
        </div>
        {goalLabel && <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)] normal-case">{goalLabel}</span>}
      </div>

      <ul className="space-y-3">
        {training.map((row) => <ZoneRow key={row.zoneId} row={row} />)}
      </ul>

      {passive && (
        <p className="mt-3 border-t border-[color:var(--border)] pt-2.5 text-[11px] leading-snug text-[color:var(--muted-foreground)]">
          <b style={{ color: passive.status === 'complete' ? 'var(--accent-green)' : passiveMeta?.color }}>
            Z1 {passiveMeta?.name} {passive.status === 'complete' ? 'complete' : `${passive.doneMin}/${passive.targetMin} min`}
          </b>
          {' — '}Zone 1 fills from ordinary daily movement, so it isn&rsquo;t counted toward your training week.
        </p>
      )}
    </div>
  )
}

export const ZoneQuotaCard = memo(ZoneQuotaCardImpl)
