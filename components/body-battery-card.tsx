'use client'

import { useState } from 'react'
import {
  BatteryFull, BatteryMedium, BatteryLow, BatteryWarning,
  ArrowUp, ArrowDown, Minus, ChevronDownIcon,
  Sunrise, Moon, Bed, Dumbbell, HeartPulse, Activity, SignalLow, type LucideIcon,
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { fmtAest } from '@trainingai/shared/date-utils'
import { bodyBatteryColor, type BodyBatteryLabel } from '@trainingai/shared/health/body-battery-band'
import { StressStrip } from '@/components/body-battery/stress-strip'
import type { BodyBatteryResponse } from '@/app/api/body-battery/route'

const BATTERY_ICON: Record<BodyBatteryLabel, LucideIcon> = {
  Charged: BatteryFull,
  Good: BatteryMedium,
  Low: BatteryLow,
  Drained: BatteryWarning,
}

function BatteryIcon({ label }: { label: BodyBatteryLabel }): React.ReactElement {
  const Icon = BATTERY_ICON[label]
  return <Icon className="h-4 w-4" style={{ color: bodyBatteryColor(label) }} />
}

function TrendBadge({ trend }: { trend: BodyBatteryResponse['trend'] }) {
  const map = {
    charging: { Icon: ArrowUp, color: '#22c55e', text: 'Charging' },
    draining: { Icon: ArrowDown, color: '#ef4444', text: 'Draining' },
    steady:   { Icon: Minus, color: 'var(--color-muted-foreground)', text: 'Steady' },
  }[trend]
  const { Icon } = map
  return (
    <span className="flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: map.color }}>
      <Icon className="h-3 w-3" />
      {map.text}
    </span>
  )
}

function DayChart({ data }: { data: BodyBatteryResponse }) {
  const { series } = data
  if (series.length < 2) return null
  const W = 300, H = 80
  const t0 = series[0].t
  const t1 = series[series.length - 1].t
  const span = Math.max(1, t1 - t0)
  const x = (t: number) => ((t - t0) / span) * W
  const y = (v: number) => H - (v / 100) * H

  const linePts = series.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const areaPts = `0,${H} ${linePts} ${W},${H}`
  const color = bodyBatteryColor(data.label)

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="overflow-visible">
        <defs>
          <linearGradient id="bb-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* 50% guide line */}
        <line x1="0" y1={y(50)} x2={W} y2={y(50)} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3 3" />
        <polygon points={areaPts} fill="url(#bb-fill)" />
        <polyline
          points={linePts}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
        <span>{fmtAest(t0)}</span>
        <span>{fmtAest(t1)}</span>
      </div>
    </div>
  )
}

export function BodyBatteryCard({ battery }: { battery: BodyBatteryResponse }) {
  const [expanded, setExpanded] = useState(false)
  const color = bodyBatteryColor(battery.label)
  // A sparse HR day produces a nearly flat arc that looks exactly like a genuinely calm one. Say
  // which it is — the number stays, it just stops being presented as measured (Q-57).
  // `confidence` is optional at runtime despite the type: this card paints first from a cached
  // payload (`readTodayCacheSync`), and a seed written before this field shipped has no such key.
  // Absent means "not known", which must read as no warning rather than as a warning.
  const conf = battery.confidence as BodyBatteryResponse['confidence'] | undefined
  const lowData = battery.hasData && conf != null && !conf.sufficient

  return (
    <div className="mx-4 mb-3">
    <button
      type="button"
      className="block w-full text-left rounded-xl border border-border overflow-hidden select-none"
      style={{ background: 'var(--brand-card-bg)' }}
      onClick={() => setExpanded(e => !e)}
      aria-expanded={expanded}
    >
      {/* ── Collapsed ── */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 mb-2">
          <BatteryIcon label={battery.label} />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">
            Body Battery
          </span>
          <span className="text-sm font-semibold leading-none" style={{ color }}>
            {battery.label}
          </span>
          <div className="flex-1" />
          {/* Not a control — this card is itself a <button>, and nesting one inside it is
              undefined behaviour in Samsung's WebView. */}
          {lowData && (
            <span className="flex items-center gap-1 rounded-full bg-muted/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground leading-none">
              <SignalLow className="h-3 w-3 flex-none" />
              Limited data
            </span>
          )}
          <TrendBadge trend={battery.trend} />
          <span className="text-xl font-bold tabular-nums leading-none" style={{ color }}>
            {battery.current}
          </span>
          <ChevronDownIcon
            className="h-4 w-4 text-muted-foreground flex-none transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
          />
        </div>
        {/* progress bar — fill anchored right so the tank empties from the left */}
        <div className="h-2 rounded-full overflow-hidden bg-muted/60 flex justify-end">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${battery.current}%`, background: color }}
          />
        </div>
      </div>

      {/* ── Expanded ── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-2 border-t border-border/40 space-y-3">
              {battery.hasData ? (
                <>
                  <DayChart data={battery} />
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Started at <span className="font-semibold text-foreground tabular-nums">{battery.anchor}</span>
                      {battery.anchorSource === 'readiness' && ' from readiness'}
                      {battery.anchorSource === 'sleep' && ' from sleep'}
                      {/* The level legitimately moves once today's readiness lands. Saying so is
                          the difference between an explained change and an unexplained one. */}
                      {battery.anchorProvisional && ' · provisional until readiness lands'}
                    </span>
                    <span className="flex items-center gap-3 tabular-nums">
                      <span className="text-green-400 font-semibold">+{battery.charged} charged</span>
                      <span className="text-red-400 font-semibold">−{battery.drained} drained</span>
                    </span>
                  </div>
                  {lowData && (
                    <p className="rounded-lg border border-border bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
                      <SignalLow className="mr-1 inline h-3 w-3 align-[-2px]" />
                      Your ring recorded only <span className="font-semibold text-foreground tabular-nums">{conf?.sampleCount}</span> heart-rate
                      readings since you woke — about <span className="tabular-nums">{conf?.samplesPerHour}</span> an hour. The ring stops
                      sampling when you are still, so today&apos;s line is mostly gaps held flat rather than a
                      measured calm. Treat the number as a rough guide.
                    </p>
                  )}
                  {battery.stress && <StressStrip stress={battery.stress} />}
                </>
              ) : (
                <div className="space-y-2 py-1">
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Body Battery is your live energy tank. It opens each morning at your
                    readiness score, then <span className="text-red-400 font-medium">drains</span> as
                    you train or your heart rate climbs and <span className="text-green-400 font-medium">recharges</span> while
                    you rest.
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Currently <span className="font-semibold text-foreground tabular-nums">{battery.anchor}</span>
                    {battery.anchorSource === 'readiness' && ', from this morning’s readiness'}
                    {battery.anchorSource === 'sleep' && ', from last night’s sleep'}
                    {battery.anchorProvisional && ' — provisional, and re-anchors once today’s readiness is ready'}
                    . Today&apos;s minute-by-minute graph appears here once your heart-rate data syncs.
                  </p>
                </div>
              )}

              {/* "How it moves" — a compact charge/drain diagram (icons over prose) shown whenever
                  expanded, tying the home signals to how the battery fills and empties. */}
              <div className="rounded-lg bg-muted/40 border border-border p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">How it moves</p>
                <div className="mb-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Sunrise className="h-3.5 w-3.5 flex-none text-amber-400" />
                  <span>
                    Opens each morning at your{" "}
                    <span className="font-medium text-foreground">
                      {battery.anchorSource === "sleep" ? "Sleep" : "Readiness"}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-green-500/20 bg-green-500/10 p-2">
                    <div className="mb-1.5 flex items-center gap-1">
                      <ArrowUp className="h-3 w-3 text-green-600 dark:text-green-400" />
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-green-600 dark:text-green-400">Recharges</span>
                    </div>
                    <ul className="space-y-1">
                      <li className="flex items-center gap-1.5 text-[11px] text-foreground"><Moon className="h-3.5 w-3.5 flex-none text-muted-foreground" /> Deep sleep</li>
                      <li className="flex items-center gap-1.5 text-[11px] text-foreground"><Bed className="h-3.5 w-3.5 flex-none text-muted-foreground" /> Calm rest</li>
                    </ul>
                  </div>
                  <div className="rounded-md border border-red-500/20 bg-red-500/10 p-2">
                    <div className="mb-1.5 flex items-center gap-1">
                      <ArrowDown className="h-3 w-3 text-red-600 dark:text-red-400" />
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">Drains</span>
                    </div>
                    <ul className="space-y-1">
                      <li className="flex items-center gap-1.5 text-[11px] text-foreground"><Dumbbell className="h-3.5 w-3.5 flex-none text-muted-foreground" /> Training</li>
                      <li className="flex items-center gap-1.5 text-[11px] text-foreground"><HeartPulse className="h-3.5 w-3.5 flex-none text-muted-foreground" /> High heart rate</li>
                      <li className="flex items-center gap-1.5 text-[11px] text-foreground"><Activity className="h-3.5 w-3.5 flex-none text-muted-foreground" /> Daytime stress</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </button>
    </div>
  )
}
