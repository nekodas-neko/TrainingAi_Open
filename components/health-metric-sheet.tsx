"use client";

import { useEffect, useState } from "react";
import { Sparkline } from '@/components/ui/sparkline'
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import { useUserTimezone } from '@/components/shell/user-timezone-provider';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChevronLeft } from "lucide-react";
import { Hypnogram, STAGE_COLOR } from "@/components/health/hypnogram";
import { EmptyState } from "@/components/ui/empty-state";
import { actualSleepWindow } from "@/lib/sleep/actual-window";
import { MetricScale, rangeStats } from "@/components/health/metric-scale";

export interface HealthReading {
  date: string;
  value: number | null;
}

export interface SleepDetailReading {
  date: string;
  durationHours: number | null;
  deepSleepHours: number | null;
  remSleepHours: number | null;
  lightSleepHours: number | null;
  awakHours: number | null;
  sleepStart?: string | null;
  sleepEnd?: string | null;
  sleepPhase5Min?: string | null;
  phaseWindowStart?: string | null;
  phaseWindowEnd?: string | null;
  avgHeartRate?: number | null;
  restlessPeriods?: number | null;
  onsetLatencySec?: number | null;
  efficiency?: number | null;
  averageHrvMs?: number | null;
  lowestHeartRate?: number | null;
  respiratoryRate?: number | null;
  sleepScore?: number | null;
  sleepTimeRecommendation?: string | null;
}

interface HealthMetricSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  unit: string;
  color: string;
  readings?: HealthReading[];
  sleepReadings?: SleepDetailReading[];
  formatValue?: (v: number) => string;
  // Q-93-followup: pre-selects the matching night's detail view on open, instead of the list —
  // a deep link from the timeline's "Woke up"/"Fell asleep" cards.
  initialDate?: string | null;
}

/** NOT `components/ui/sparkline.tsx`, despite the shape. Renamed from `Sparkline` on 2026-08-09
 *  because the identical local name shadowed the primitive: `grep -rn '<Sparkline'` returned this
 *  file's two call sites as if they used it. This one adds a value label on the last point, a
 *  bigger final dot, and — the part that actually blocks conversion — scales y to the exact
 *  min/max, where the primitive pads by ±0.5 and would halve the amplitude of a 0.5 kg spread.
 *  See Q-154. */
/**
 * The metric trend, drawn by the shared `Sparkline` (Q-154).
 *
 * It was a hand-rolled polyline, one of three the repo carried. What kept it inline was that the
 * primitive could not draw it: it padded values by ±0.5 (which halves a 0.5 kg body-weight spread),
 * hardcoded `strokeWidth`, insets nothing, and had no emphasized last dot or value label. Those are
 * props now — all defaulted, so the call sites that predate them are untouched.
 *
 * **One deliberate visual change, decided by the owner 2026-08-25:** the non-final dots are no
 * longer dimmed to 0.4. Keeping them would have meant a per-caller opacity prop, and a primitive
 * that grows a prop for each caller's art is a wrapper over a config object rather than a
 * unification — the same call Q-406 made when it declined a warning slot on `FoodRow`.
 */
function MetricTrendChart({ pts, color, unit, formatValue }: {
  pts: { date: string; value: number }[];
  color: string;
  unit: string;
  formatValue: (v: number) => string;
}) {
  if (pts.length < 2) return null;
  const vals = pts.map(p => p.value);
  const last = vals[vals.length - 1];
  return (
    <div className="rounded-xl border p-3">
      <Sparkline
        values={vals}
        width={300}
        height={72}
        color={color}
        responsive
        fill
        showDots
        pad={10}
        valuePadding={0}
        strokeWidth={2}
        emphasizeLast
        valueLabel={`${formatValue(last)}${unit}`}
      />
    </div>
  );
}

// tz threaded, not defaulted — module scope cannot read the user-timezone context (Q-148).
const fmtTime = (iso: string, tz: string) => formatTimeOfDay(iso, tz)

function fmtHours(h: number) {
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  if (hrs === 0) return `${mins}m`
  if (mins === 0) return `${hrs}h`
  return `${hrs}h ${mins}m`
}

const STAGE_DEFS = [
  { key: 'deepSleepHours' as const,  label: 'Deep',  color: STAGE_COLOR.deep },
  { key: 'remSleepHours'  as const,  label: 'REM',   color: STAGE_COLOR.rem },
  { key: 'lightSleepHours' as const, label: 'Light', color: STAGE_COLOR.light },
  { key: 'awakHours'      as const,  label: 'Awake', color: STAGE_COLOR.awake },
]

const SLEEP_TIME_RECOMMENDATION_LABELS: Record<string, string> = {
  improve_efficiency: "Focus on sleep quality tonight — efficiency has room to improve.",
  earlier_bedtime: "Try an earlier bedtime tonight.",
  later_bedtime: "Try a later bedtime tonight.",
  earlier_wake_up_time: "Try waking up earlier.",
  later_wake_up_time: "Try waking up later.",
  follow_optimal_bedtime: "You're close to your optimal bedtime window — keep it up.",
}

function SleepDetailView({ r, allNights = [], color, onBack }: { r: SleepDetailReading; allNights?: SleepDetailReading[]; color: string; onBack: () => void }) {
  const userTz = useUserTimezone()
  const total = r.durationHours ?? 0
  // Q-101: the range START is the raw bedtime, matching the Hypnogram ribbon and the day-timeline
  // "Fell asleep" card — onset latency is surfaced separately (below and inline here), never folded
  // into the displayed time. The range END still comes from actualSleepWindow(): its trim doesn't
  // touch the end, but the ring's phase string is padded up to a whole 5-min epoch at build time, so
  // the raw end can overshoot the real wake time by up to ~5 min — that correction is unrelated to
  // the bedtime bug and still needed.
  const asleepWindow = actualSleepWindow(r)
  const displayStart = r.sleepStart
  const displayEnd = asleepWindow?.end ?? r.sleepEnd
  const onsetMin = r.onsetLatencySec != null ? Math.round(r.onsetLatencySec / 60) : null
  const stages = STAGE_DEFS.map(s => ({ ...s, hours: r[s.key] ?? 0 }))
  const stageTotal = stages.reduce((sum, s) => sum + s.hours, 0) || 1
  const recommendation = r.sleepTimeRecommendation ? SLEEP_TIME_RECOMMENDATION_LABELS[r.sleepTimeRecommendation] : null

  // Distributions over the recent nights, for the "vs your recent nights" scales below.
  const durStats  = rangeStats(allNights.map(n => n.durationHours))
  const effStats  = rangeStats(allNights.map(n => n.efficiency))
  const hrvStats  = rangeStats(allNights.map(n => n.averageHrvMs))
  const rhrStats  = rangeStats(allNights.map(n => n.lowestHeartRate))
  const brStats   = rangeStats(allNights.map(n => n.respiratoryRate))

  // Secondary metric tiles the list card shows but this view previously dropped.
  const extraTiles = [
    r.efficiency != null      && { label: 'Efficiency',     value: `${Math.round(r.efficiency)}%` },
    r.averageHrvMs != null    && { label: 'HRV (overnight)', value: `${Math.round(r.averageHrvMs)} ms` },
    r.lowestHeartRate != null && { label: 'Lowest HR',      value: `${r.lowestHeartRate} bpm` },
    r.respiratoryRate != null && { label: 'Breathing rate', value: `${r.respiratoryRate.toFixed(1)} br/m` },
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 pt-1 pb-3 shrink-0 border-b border-border/50">
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted transition text-muted-foreground"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-sm font-semibold">{r.date}</span>
        {displayStart && displayEnd && (
          <span className="text-xs text-muted-foreground ml-1">
            {fmtTime(displayStart, userTz)} – {fmtTime(displayEnd, userTz)}
            {onsetMin != null && ` · ${onsetMin}m latency`}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Duration hero */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Time Asleep</p>
          <p className="text-4xl font-bold mt-1" style={{ color }}>{fmtHours(total)}</p>
        </div>

        {/* Avg heart rate / onset / restless periods — Oura-enriched nights only */}
        {(r.avgHeartRate != null || r.restlessPeriods != null || r.onsetLatencySec != null) && (
          <div className="flex gap-4 flex-wrap">
            {r.avgHeartRate != null && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Avg Heart Rate</p>
                <p className="text-lg font-semibold mt-0.5 tabular-nums">{r.avgHeartRate} bpm</p>
              </div>
            )}
            {r.onsetLatencySec != null && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Sleep Latency</p>
                <p className="text-lg font-semibold mt-0.5 tabular-nums">{Math.round(r.onsetLatencySec / 60)}m</p>
                <p className="text-[10px] text-muted-foreground">to fall asleep</p>
              </div>
            )}
            {r.restlessPeriods != null && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Restless Periods</p>
                <p className="text-lg font-semibold mt-0.5 tabular-nums">{r.restlessPeriods}</p>
              </div>
            )}
          </div>
        )}

        {/* Secondary metrics the list card shows (efficiency / HRV / lowest HR / breathing rate) */}
        {extraTiles.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {extraTiles.map(t => (
              <div key={t.label} className="rounded-lg bg-muted/40 border border-border px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t.label}</p>
                <p className="text-lg font-semibold mt-0.5 tabular-nums">{t.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* How this night compares to your recent nights */}
        {allNights.length >= 3 && (durStats.max != null || effStats.max != null || hrvStats.max != null || rhrStats.max != null) && (
          <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Vs your recent nights</p>
            <MetricScale label="Time asleep" value={r.durationHours} min={durStats.min} max={durStats.max} avg={durStats.avg} accent={color} format={v => fmtHours(v)} optimal="high" />
            <MetricScale label="Efficiency" value={r.efficiency ?? null} min={effStats.min} max={effStats.max} avg={effStats.avg} accent={color} format={v => `${Math.round(v)}%`} optimal="high" />
            <MetricScale label="HRV (overnight)" value={r.averageHrvMs ?? null} min={hrvStats.min} max={hrvStats.max} avg={hrvStats.avg} accent={color} format={v => `${Math.round(v)} ms`} optimal="high" />
            <MetricScale label="Lowest HR" value={r.lowestHeartRate ?? null} min={rhrStats.min} max={rhrStats.max} avg={rhrStats.avg} accent={color} format={v => `${Math.round(v)} bpm`} optimal="low" />
            <MetricScale label="Breathing rate" value={r.respiratoryRate ?? null} min={brStats.min} max={brStats.max} avg={brStats.avg} accent={color} format={v => `${v.toFixed(1)} br/m`} optimal="mid" />
          </div>
        )}

        {recommendation && (
          <p className="text-xs text-muted-foreground rounded-lg bg-muted/40 border border-border px-3 py-2">
            {recommendation}
          </p>
        )}

        {/* Sleep stage timeline — hypnogram when Oura data available, proportion bar otherwise */}
        {r.sleepPhase5Min && r.sleepStart && r.sleepEnd ? (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Sleep Stages</p>
            <Hypnogram size="sm" phase5Min={r.sleepPhase5Min} sleepStart={r.phaseWindowStart ?? r.sleepStart} sleepEnd={r.phaseWindowEnd ?? r.sleepEnd} />
          </div>
        ) : stageTotal > 0 ? (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Sleep Stages</p>
            <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
              {stages.filter(s => s.hours > 0).map(s => (
                <div
                  key={s.key}
                  style={{ width: `${(s.hours / stageTotal) * 100}%`, background: s.color }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* Stage breakdown list */}
        <div className="space-y-2">
          {stages.map(s => {
            const pct = Math.round((s.hours / stageTotal) * 100)
            const barWidth = (s.hours / stageTotal) * 100
            return (
              <div key={s.key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="font-medium">{s.label}</span>
                  </div>
                  <div className="flex items-center gap-2 tabular-nums">
                    <span className="text-muted-foreground">{pct}%</span>
                    <span className="font-semibold w-14 text-right">{s.hours > 0 ? fmtHours(s.hours) : '—'}</span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${barWidth}%`, background: s.color }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function HealthMetricSheet({
  open, onClose, title, unit, color,
  readings = [], sleepReadings = [],
  formatValue = (v: number) => String(v),
  initialDate,
}: HealthMetricSheetProps) {
  const userTz = useUserTimezone()
  const [selectedSleep, setSelectedSleep] = useState<SleepDetailReading | null>(null)

  const nonNullReadings = readings.filter((r): r is { date: string; value: number } => r.value != null);
  const nonNullSleep    = sleepReadings.filter(r => r.durationHours != null);
  const isSleep         = sleepReadings.length > 0;

  // Q-93-followup: jump straight to a specific night's detail view when opened with a date
  // (rather than the list) — falls back to the list silently if that night isn't in the
  // loaded window (older than 14 days), same as any other "no data" case here.
  useEffect(() => {
    if (!open || !initialDate) return
    const match = sleepReadings.find(r => r.date === initialDate)
    if (match) setSelectedSleep(match)
  }, [open, initialDate, sleepReadings])

  function handleClose() {
    setSelectedSleep(null)
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) handleClose(); }}>
      <SheetContent side="bottom" className="max-h-[85dvh] flex flex-col px-4">
        {selectedSleep ? (
          <>
            <SheetHeader className="flex-none sr-only">
              <SheetTitle style={{ color }}>Sleep Detail</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-hidden flex flex-col -mx-4 mt-2">
              <SleepDetailView
                r={selectedSleep}
                allNights={nonNullSleep}
                color={color}
                onBack={() => setSelectedSleep(null)}
              />
            </div>
          </>
        ) : (
          <>
            <SheetHeader className="flex-none">
              <SheetTitle style={{ color }}>{title}</SheetTitle>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto space-y-3 pb-2 mt-2">
              {/* Trend sparkline */}
              {!isSleep && nonNullReadings.length >= 2 && (
                <MetricTrendChart pts={nonNullReadings} color={color} unit={unit} formatValue={formatValue} />
              )}

              {/* Sleep sparkline */}
              {isSleep && nonNullSleep.length >= 2 && (() => {
                const sparklePts = nonNullSleep.map(r => ({ date: r.date, value: r.durationHours! }));
                return (
                  <MetricTrendChart pts={sparklePts} color={color} unit="h" formatValue={v => v.toFixed(1)} />
                );
              })()}

              {/* Readings list */}
              <div className="rounded-xl border divide-y divide-border/50 overflow-hidden">
                {isSleep ? (
                  sleepReadings.slice(0, 14).map(r => {
                    // Q-101: raw bedtime for the range start (see SleepDetailView above for why);
                    // the recorded-end correction from actualSleepWindow() is still wanted.
                    const win = actualSleepWindow(r)
                    const rangeStart = r.sleepStart
                    const rangeEnd = win?.end ?? r.sleepEnd
                    const onsetMin = r.onsetLatencySec != null ? Math.round(r.onsetLatencySec / 60) : null
                    const timeRange = rangeStart && rangeEnd
                      ? `${fmtTime(rangeStart, userTz)} – ${fmtTime(rangeEnd, userTz)}${onsetMin != null ? ` · ${onsetMin}m latency` : ''}`
                      : null
                    return (
                      <button
                        key={r.date}
                        type="button"
                        onClick={() => setSelectedSleep(r)}
                        className="w-full px-3 py-2.5 flex items-start justify-between gap-3 hover:bg-muted/40 transition-colors text-left"
                      >
                        <div className="flex-none mt-0.5">
                          <span className="text-xs text-muted-foreground">{r.date}</span>
                          {timeRange && <p className="text-[9px] text-muted-foreground/70 mt-0.5">{timeRange}</p>}
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold tabular-nums" style={{ color }}>
                            {r.durationHours != null ? `${r.durationHours.toFixed(1)}h` : "—"}
                          </span>
                          {r.durationHours != null && (
                            <div className="flex gap-1 justify-end flex-wrap mt-0.5">
                              {r.deepSleepHours  != null && <span className="text-[9px] rounded bg-blue-500/20 text-blue-400 px-1.5 py-0.5">Deep {r.deepSleepHours.toFixed(1)}h</span>}
                              {r.remSleepHours   != null && <span className="text-[9px] rounded bg-violet-500/20 text-violet-400 px-1.5 py-0.5">REM {r.remSleepHours.toFixed(1)}h</span>}
                              {r.lightSleepHours != null && <span className="text-[9px] rounded bg-sky-500/20 text-sky-400 px-1.5 py-0.5">Light {r.lightSleepHours.toFixed(1)}h</span>}
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })
                ) : (
                  readings.slice(0, 14).map(r => (
                    <div key={r.date} className="px-3 py-2.5 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{r.date}</span>
                      <span className="text-sm font-bold tabular-nums" style={{ color }}>
                        {r.value != null ? `${formatValue(r.value)}${unit}` : "—"}
                      </span>
                    </div>
                  ))
                )}
                {!isSleep && readings.length === 0 && (
                  <EmptyState title="No data recorded yet" />
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
