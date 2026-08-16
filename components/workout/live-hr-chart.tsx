// components/workout/live-hr-chart.tsx
'use client'
import { memo, useEffect, useState, useSyncExternalStore } from 'react'
import { HeartPulseIcon } from 'lucide-react'
import { useLiveHr } from '@/lib/live-hr/use-live-hr'
import { rollingMedian } from '@trainingai/shared/health/hr-smoothing'
import { computeHrZones, zoneForBpm } from '@trainingai/shared/health/hr-zones'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { HR_PROFILE_TTL } from '@trainingai/shared/cache-ttl'
import type { HrProfileResponse } from '@/app/api/hr-profile/route'
import { subscribeTrace, getTraceSnapshot } from '@/lib/live-hr/exercise-trace'

const W = 320                 // viewBox width (px); responsive stretches to container
const PAD_Y = 10
const H_FULL = 72             // summary card — full-height trace
const H_COMPACT = 44          // in-workout rest card — shorter, to spare the fixed layout

// Leaf-scoped reader of the shared exercise HR trace (lib/live-hr/exercise-trace) — the
// recording is owned by the workout orchestrator's 1 Hz tick, so this component only reads
// and re-renders on new beats (never the ~1,000-line workout screen). Two presentations:
//   • Active workout (rest phase only): pass `sinceMs = restStartMs` → shows just the
//     current rest's recovery dip. The set-phase PPG reads poorly under grip/motion, so
//     showing it mid-set was distracting and looked inaccurate (dropped mid-set, ramped in
//     rest) — hence rest-only there.
//   • Exercise summary: pass `showSetLines` → replays the whole exercise with dotted per-set
//     boundary markers.
function LiveHrChartInner({
  sinceMs = null,
  showSetLines = false,
  compact = false,
  className,
}: {
  sinceMs?: number | null
  showSetLines?: boolean
  compact?: boolean
  className?: string
}) {
  const H = compact ? H_COMPACT : H_FULL
  const { bpm, live, stale } = useLiveHr()
  const trace = useSyncExternalStore(subscribeTrace, getTraceSnapshot, getTraceSnapshot)

  const [profile, setProfile] = useState<HrProfileResponse | null>(null)
  useEffect(() => {
    const seed = readCacheSync<HrProfileResponse>('hr-profile')
    if (seed) setProfile(seed)
    cachedFetch<HrProfileResponse>('hr-profile', '/api/hr-profile', HR_PROFILE_TTL, setProfile).catch(() => {})
  }, [])

  const samples = sinceMs != null ? trace.samples.filter(s => s.at >= sinceMs) : trace.samples

  const zones = profile ? computeHrZones(profile) : null
  const smoothed = rollingMedian(samples.map(s => s.bpm), 3)
  const displayBpm = smoothed.length ? smoothed[smoothed.length - 1] : bpm
  const zone = zones && displayBpm != null ? zoneForBpm(displayBpm, zones) : null
  const accent = zone?.color ?? 'var(--color-brand)'
  const gradId = `livehr-${zone?.id ?? 'x'}`

  const hasTrace = smoothed.length >= 2

  // ── Geometry (time → x, bpm → y) ────────────────────────────────────────────
  const now = samples.length ? samples[samples.length - 1].at : Date.now()
  const origin = sinceMs ?? trace.originMs ?? (samples.length ? samples[0].at : now)
  const span = Math.max(1, now - origin)
  const yMin = hasTrace ? Math.min(...smoothed) - 4 : 40
  const yMax = hasTrace ? Math.max(...smoothed) + 4 : 180
  const yRange = yMax - yMin || 1
  const xFor = (at: number) => ((at - origin) / span) * W
  const yFor = (v: number) => H - PAD_Y - ((v - yMin) / yRange) * (H - 2 * PAD_Y)

  const linePts = samples.map((s, i) => `${xFor(s.at).toFixed(1)},${yFor(smoothed[i]).toFixed(1)}`).join(' ')

  // Logged-set boundaries visible within the current window (summary view only).
  const setLines = showSetLines
    ? trace.setBoundaries
        .map((end, i) => ({ i, end }))
        .filter(m => m.end >= origin && m.end <= now)
    : []

  return (
    <div
      className={`rounded-2xl border border-border bg-muted/40 px-4 transition-opacity ${compact ? 'py-2' : 'py-3'} ${stale ? 'opacity-70' : ''} ${className ?? ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <HeartPulseIcon className={`h-3.5 w-3.5 ${live ? 'animate-pulse' : ''}`} style={{ color: accent }} /> Live HR
        </span>
        <span className="flex items-baseline gap-1.5">
          {zone && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{ color: accent, background: `color-mix(in oklch, ${accent} 16%, transparent)` }}
            >
              {zone.name}
            </span>
          )}
          <span className="text-2xl font-bold leading-none tabular-nums" style={{ color: accent }}>
            {displayBpm ?? '—'}
          </span>
          <span className="text-[10px] font-medium text-muted-foreground">bpm</span>
        </span>
      </div>

      <div className="mt-2" style={{ height: H }}>
        {hasTrace ? (
          <svg
            width="100%"
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="overflow-visible"
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity="0.22" />
                <stop offset="100%" stopColor={accent} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Dotted per-set boundary line + set number per logged set (summary view). */}
            {setLines.map(m => {
              const x = xFor(m.end)
              return (
                <g key={m.i}>
                  <line
                    x1={x} y1={0} x2={x} y2={H}
                    stroke="var(--color-muted-foreground)" strokeWidth="1"
                    strokeDasharray="3 3" opacity="0.5"
                  />
                  <text x={x - 2} y={9} textAnchor="end" fontSize="9" fill="var(--color-muted-foreground)">
                    {m.i + 1}
                  </text>
                </g>
              )
            })}

            <polygon points={`0,${H} ${linePts} ${xFor(now).toFixed(1)},${H}`} fill={`url(#${gradId})`} />
            <polyline
              points={linePts}
              fill="none" stroke={accent} strokeWidth="1.75"
              strokeLinecap="round" strokeLinejoin="round"
            />
            {/* "Now" marker — where you currently are */}
            <circle cx={xFor(now)} cy={yFor(smoothed[smoothed.length - 1])} r="2.5" fill={accent} />
          </svg>
        ) : (
          <p className="pt-3 text-[11px] text-muted-foreground">
            {live ? 'Reading…' : bpm != null ? 'Holding last reading…' : 'Waiting for your strap or ring…'}
          </p>
        )}
      </div>
    </div>
  )
}

export const LiveHrChart = memo(LiveHrChartInner)
