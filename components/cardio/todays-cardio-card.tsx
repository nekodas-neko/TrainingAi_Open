'use client'

import { memo, useState } from 'react'
import { Footprints, PersonStanding, ChevronRight, HeartPulse, Activity, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateDisplay } from '@trainingai/shared/date-utils'
import type { HeartHealthActivity, HeartHealthDayOutcome } from '@trainingai/shared/running/heart-health'
import {
  ANY_ACTIVITY, CARD_TITLE, OUTCOME_COLOR, OUTCOME_LABEL, PROGRESS_LABEL, RATIONALE,
  activityLine, criterionLine, progressFigure, shownActivity, zoneLabel, countedMinutesLine,
} from './todays-cardio-copy'

/** The presets the treadmill row offers. 30 is drawn first because it clears a 25-minute target
 *  outright — the common case is meant to be two taps. */
export const TREADMILL_PRESET_MIN = [20, 30, 45] as const

/** One day of the week as the running-plan payload carries it (`HeartHealthDay` on the server). */
export interface HeartHealthDayView {
  date: string
  runId: string
  status: 'pending' | 'completed' | 'skipped'
  targetMin: number | null
  countedMin: number
  met: boolean
  outcome: HeartHealthDayOutcome
  creditedId: string | null
  activities: HeartHealthActivity[]
}

export interface TodaysCardioCardProps {
  durationMin: number | null
  targetZoneIds: number[]
  runStatus: 'pending' | 'completed' | 'skipped'
  /** Today's measured day, when the payload carried one. */
  today: HeartHealthDayView | null
  /** This week's days, oldest first, today included. */
  week: HeartHealthDayView[]
  onGuidedWalk: () => void
  onTreadmillWalk: (durationMin: number) => void
  onRun: () => void
  onOtherActivity: () => void
}

function ChooserRow({ onClick, icon, title, note }: {
  onClick: () => void
  icon: React.ReactNode
  title: string
  note: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--background)] p-2.5 text-left"
    >
      <span className="shrink-0 text-[color:var(--accent-cyan)]" aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold">{title}</span>
        <span className="block text-[11px] leading-snug text-[color:var(--muted-foreground)]">{note}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]" aria-hidden />
    </button>
  )
}

function HistoryRow({ day }: { day: HeartHealthDayView }) {
  const shown = shownActivity(day.activities, day.creditedId)
  const sub = countedMinutesLine(day.activities, day.countedMin)
  return (
    <li className="flex items-center gap-2.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] px-2.5 py-2 text-xs">
      <span className="w-8 shrink-0 tabular-nums text-[color:var(--muted-foreground)]">
        {formatDateDisplay(day.date, 'weekday')}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{shown ? activityLine(shown) : 'No activity logged'}</span>
        {sub && <span className="block text-[11px] text-[color:var(--muted-foreground)]">{sub}</span>}
      </span>
      <span
        className="shrink-0 text-[11px] font-semibold"
        style={{ color: OUTCOME_COLOR[day.outcome] ?? 'var(--muted-foreground)' }}
      >
        {OUTCOME_LABEL[day.outcome]}
      </span>
    </li>
  )
}

export const TodaysCardioCard = memo(function TodaysCardioCard(p: TodaysCardioCardProps) {
  const [chooserOpen, setChooserOpen] = useState(false)
  const target = p.today?.targetMin ?? (p.durationMin != null && p.durationMin > 0 ? Math.round(p.durationMin) : null)
  const counted = p.today?.countedMin ?? 0
  const isDone = p.runStatus === 'completed' || p.today?.met === true
  const zone = zoneLabel(p.targetZoneIds)
  const credited = p.today ? shownActivity(p.today.activities, p.today.creditedId) : null
  const others = p.today ? p.today.activities.length - (credited ? 1 : 0) : 0
  const unmeasured = p.today != null && p.today.activities.length > 0 && p.today.activities.every((a) => a.effortMin == null)
  const pct = target ? Math.min(100, Math.round((counted / target) * 100)) : 0

  return (
    <div className="flex flex-col gap-1.5">
      {/* A landmark because the hub already has a "Guided walk" button and a "What do you want to
          do?" heading — without one, nothing on this card can be addressed unambiguously. */}
      <section aria-label={CARD_TITLE} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-4">
        <div className="flex items-center gap-2">
          <HeartPulse className="h-5 w-5 shrink-0" style={{ color: 'var(--accent-cyan)' }} aria-hidden />
          <h2 className="text-lg font-bold">{CARD_TITLE}</h2>
          {zone && (
            <span
              className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ color: 'var(--accent-cyan)', background: 'color-mix(in oklch, var(--accent-cyan) 15%, transparent)' }}
            >
              {zone}
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[color:var(--muted-foreground)]">
          <span>{criterionLine(target)}</span>
          <span>{ANY_ACTIVITY}</span>
        </div>

        <p className="mt-3 text-sm leading-relaxed">{RATIONALE}</p>

        <div className="mt-3 flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span>{PROGRESS_LABEL}</span>
            <span className="tabular-nums" style={{ color: isDone ? 'var(--accent-green)' : 'var(--muted-foreground)' }}>
              {progressFigure(counted, target)}{isDone ? ' · Counted ✓' : ''}
            </span>
          </div>
          {/* The track sets display:flex so the fill is a block — an inline child cannot be sized. */}
          <div className="flex h-2 overflow-hidden rounded-full bg-[color:var(--muted)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${isDone ? 100 : pct}%`, background: isDone ? 'var(--accent-green)' : 'var(--accent-cyan)' }}
            />
          </div>
          {credited && (
            <span className="text-xs text-[color:var(--muted-foreground)]">
              from <b className="font-semibold text-[color:var(--foreground)]">{credited.title}</b>
              {credited.durationMin != null && credited.durationMin > 0 ? ` · ${Math.round(credited.durationMin)} min` : ''}
              {others > 0 ? ` and ${others} more` : ''}
            </span>
          )}
          {unmeasured && (
            <span className="text-[11px] text-[color:var(--muted-foreground)]">
              No heart rate recorded during it, so it has no counted minutes yet.
            </span>
          )}
        </div>

        {!isDone && !chooserOpen && (
          <Button className="mt-4 w-full" onClick={() => setChooserOpen(true)}>Start an activity</Button>
        )}

        {!isDone && chooserOpen && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">What are you doing?</p>
              <button
                type="button"
                onClick={() => setChooserOpen(false)}
                className="min-h-11 px-2 font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]"
              >
                Back
              </button>
            </div>
            <p className="text-[11px] leading-snug text-[color:var(--muted-foreground)]">
              Any of these counts for its minutes at moderate effort or above.
            </p>
            <ChooserRow
              onClick={p.onGuidedWalk}
              icon={<Footprints className="h-4 w-4" />}
              title="Guided walk"
              note="App paces you and counts zone minutes live"
            />
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background)] p-2.5">
              <p className="flex items-center gap-2 text-xs font-semibold">
                <PersonStanding className="h-4 w-4 shrink-0 text-[color:var(--accent-cyan)]" aria-hidden />
                Treadmill walk
                <span className="font-normal text-[color:var(--muted-foreground)]">· just log it</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {TREADMILL_PRESET_MIN.map((m) => (
                  <Button key={m} size="sm" variant="secondary" className="min-h-11" onClick={() => p.onTreadmillWalk(m)}>
                    {m} min
                  </Button>
                ))}
              </div>
            </div>
            <ChooserRow
              onClick={p.onRun}
              icon={<Activity className="h-4 w-4" />}
              title="Run"
              note="Tracked live, with route and pace"
            />
            <ChooserRow
              onClick={p.onOtherActivity}
              icon={<Plus className="h-4 w-4" />}
              title="Something else"
              note="Pick any activity type"
            />
          </div>
        )}
      </section>

      {p.week.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">This week</h3>
          <ul className="flex flex-col gap-1.5">
            {p.week.map((d) => <HistoryRow key={d.runId} day={d} />)}
          </ul>
        </div>
      )}
    </div>
  )
})
