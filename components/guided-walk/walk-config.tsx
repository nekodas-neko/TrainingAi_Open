'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { FootprintsIcon } from 'lucide-react'
import { SwipeCarousel } from '@/components/ui/swipe-carousel'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import { buildIntervalPlan } from '@/lib/walk/interval-plan'
import { hapticLight } from '@/lib/haptics'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { WALK_SEGMENT_STATS_TTL, CARDIO_WEEK_TTL } from '@trainingai/shared/cache-ttl'
import { recommendWalkPattern } from '@trainingai/shared/walking/recommend-walk-pattern'
import type { ZoneQuota } from '@trainingai/shared/health/zone-quota'
import { walkConfigForPattern } from '@/lib/walk/walk-pattern-config'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { WalkSegmentStatsCard } from './walk-segment-stats-card'
import type { KindAggregate } from '@/lib/walk/segment-stats'
import { DEFAULT_WALK_CONFIG } from '@/lib/walk/interval-plan'
import { CarouselDots } from '@/components/ui/carousel-dots'
import { resolveCadenceTargets } from '@/lib/walk/walk-pacer'

const PRESETS = [
  { label: 'Long', blurb: 'The classic method, repeated', sets: 5, fastSec: 180, slowSec: 180 },
  { label: 'Short', blurb: 'Shorter session, same rhythm', sets: 3, fastSec: 180, slowSec: 180 },
]

// Carousel slots. Today is reserved at 0 whether or not the recommendation has arrived, so the
// indices never shift under the selection when the fetch resolves — PRESETS sit at 1..n, and
// Custom (no fixed sets/fast/slow to match against — whatever the lifter last saved, or
// DEFAULT_WALK_CONFIG if they never have) is last.
const TODAY_INDEX = 0
const CUSTOM_INDEX = 1 + PRESETS.length
const PRESET_DOT_LABELS = ['Today', ...PRESETS.map(p => p.label), 'Custom']

interface CardioWeekQuota { quota: ZoneQuota }

function presetTotalMin(p: { sets: number; fastSec: number; slowSec: number }) {
  return Math.round((p.sets * (p.fastSec + p.slowSec)) / 60)
}

interface SegmentStats { fast: KindAggregate; slow: KindAggregate }

export function WalkConfig({ onStart }: { onStart: () => void }) {
  const config = useGuidedWalkStore(s => s.config)
  const setConfig = useGuidedWalkStore(s => s.setConfig)
  const customConfig = useGuidedWalkStore(s => s.customConfig)
  const setCustomConfig = useGuidedWalkStore(s => s.setCustomConfig)
  const totalMin = Math.round(buildIntervalPlan(config).totalSec / 60)
  // Read through the resolver, never off `config` — a config persisted before Q-410 rehydrates
  // with neither field, and a stepper bound to `undefined` renders blank and steps to NaN.
  const cadenceTargets = resolveCadenceTargets(config)

  // All-time fast/slow block stats across past interval walks — not date-scoped (like
  // running-bests), so the plain (non-today) cache variant.
  const [segmentStats, setSegmentStats] = useState<SegmentStats | null>(null)
  useEffect(() => {
    const seed = readCacheSync<SegmentStats>('walk-segment-stats')
    if (seed) setSegmentStats(seed)
    cachedFetch<SegmentStats>('walk-segment-stats', '/api/guided-walk/segment-stats', WALK_SEGMENT_STATS_TTL, setSegmentStats).catch(() => {})
  }, [])

  // The week's zone quota, which is what decides today's block structure. Same 'cardio-week' key
  // and same TTL as the running plan and the Cardiovascular hub — a second key for the same payload
  // is a cache entry that drifts.
  // `useCachedValue`, not a hand-rolled seed-then-fetch: the cardio-week key is evicted by four
  // separate write groups, and a fetch-once effect would never hear any of them.
  const cardioWeek = useCachedValue<CardioWeekQuota>('cardio-week', '/api/cardio-week', CARDIO_WEEK_TTL, { today: true })

  const recommendation = useMemo(
    () => (cardioWeek?.quota ? recommendWalkPattern(cardioWeek.quota) : null),
    [cardioWeek?.quota],
  )
  const prescribed = useMemo(
    () => (recommendation ? walkConfigForPattern(recommendation.pattern) : null),
    [recommendation],
  )

  // Which slide is selected is real state, not purely derived from config content — Custom's
  // "not set up yet" fallback (DEFAULT_WALK_CONFIG) happens to have the exact same
  // sets/fast/slow as the Long preset, so a pure content match would immediately snap a fresh
  // Custom selection straight back to "Long selected". Seeded once from content on mount (so a
  // reload still shows the right slide), then only moves in two ways below: an explicit tap/
  // swipe, or a stepper edit that no longer matches the currently selected Long/Short preset.
  const [presetIndex, setPresetIndex] = useState(() => {
    const idx = PRESETS.findIndex(p => p.sets === config.sets && p.fastSec === config.fastSec && p.slowSec === config.slowSec)
    return idx >= 0 ? idx + 1 : CUSTOM_INDEX
  })
  // Whether the walker has chosen anything this visit. The prescription auto-applies only on an
  // untouched screen — "determined for me" (owner, 2026-09-09) must not mean overwriting a slide
  // they just picked, and the fetch can resolve after they have already swiped.
  const touchedRef = useRef(false)

  // The fixed sets/fast/slow a slot stands for, or null when there is nothing to match against
  // (Custom by nature; Today until the quota arrives).
  const fixedForSlot = (index: number): { sets: number; fastSec: number; slowSec: number } | null =>
    index === TODAY_INDEX ? prescribed : index < CUSTOM_INDEX ? PRESETS[index - 1] : null

  // Fix for the pre-Q-99 bug: editing a stepper while Long/Short is selected used to leave the
  // carousel silently claiming "Long selected" even though the values no longer matched — flip
  // to Custom instead. Also the autosave: while Custom is selected, keep the persisted
  // `customConfig` in sync with every edit, so it survives switching to Long/Short and back
  // without a separate "Save as Custom" step.
  useEffect(() => {
    if (presetIndex === CUSTOM_INDEX) {
      setCustomConfig(config)
      return
    }
    const fixed = fixedForSlot(presetIndex)
    // Today before the quota lands has nothing to compare against — leaving it alone is the point,
    // since the alternative is autosaving over the walker's saved Custom on the strength of a
    // slot that is still loading.
    if (!fixed) return
    if (fixed.sets !== config.sets || fixed.fastSec !== config.fastSec || fixed.slowSec !== config.slowSec) {
      // The edit that just triggered this flip IS the custom config — save it in the same
      // pass. Deferring to a future config change would never fire if the user doesn't touch
      // another stepper, leaving the Custom slide's preview stuck on stale values.
      setPresetIndex(CUSTOM_INDEX)
      setCustomConfig(config)
    }
    // Only re-run on config changes — presetIndex is written here, not read as an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  // Apply today's prescription once it arrives, which is the whole of the owner's ask: *"I'd like
  // that to be determined for me."* Guarded on `touchedRef` rather than on config content — a
  // prescription that happens to equal what is already showing is still the app's choice, and a
  // walker who has swiped has made theirs.
  useEffect(() => {
    if (!prescribed || touchedRef.current) return
    touchedRef.current = true
    setPresetIndex(TODAY_INDEX)
    setConfig(prescribed)
    // Keyed on the pattern, not the object — `prescribed` is rebuilt on every quota change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendation?.pattern.id])

  const applyPreset = (index: number) => {
    hapticLight()
    touchedRef.current = true
    if (index === CUSTOM_INDEX) {
      setPresetIndex(index)
      setConfig(customConfig ?? DEFAULT_WALK_CONFIG)
      return
    }
    const fixed = fixedForSlot(index)
    // Today while the quota is still in flight has no config to apply; leave the selection where
    // it was rather than moving to a slide that would show one thing and run another.
    if (!fixed) return
    setPresetIndex(index)
    setConfig({ sets: fixed.sets, fastSec: fixed.fastSec, slowSec: fixed.slowSec })
  }

  const slides = useMemo(() => {
    const customPreview = customConfig ?? DEFAULT_WALK_CONFIG
    return [
      <div key="today" className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
        <p className="text-2xl font-black">{recommendation ? recommendation.pattern.label : 'Today'}</p>
        <p className="text-xs text-[color:var(--muted-foreground)]">
          {recommendation ? recommendation.reason : 'Working out today’s walk…'}
        </p>
        {prescribed && (
          <p className="text-sm font-semibold">
            {prescribed.fastSec > 0 && prescribed.slowSec > 0
              ? `${prescribed.sets}×${prescribed.fastSec / 60}/${prescribed.slowSec / 60} min`
              : `${(prescribed.fastSec + prescribed.slowSec) / 60} min continuous`}
            {' '}· ~{presetTotalMin(prescribed)} min total
          </p>
        )}
      </div>,
      ...PRESETS.map((p) => (
        <div key={p.label} className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
          <p className="text-2xl font-black">{p.label}</p>
          <p className="text-xs text-[color:var(--muted-foreground)]">{p.blurb}</p>
          <p className="text-sm font-semibold">
            {p.sets}×{p.fastSec / 60}/{p.slowSec / 60} min · ~{presetTotalMin(p)} min total
          </p>
        </div>
      )),
      <div key="custom" className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
        <p className="text-2xl font-black">Custom</p>
        <p className="text-xs text-[color:var(--muted-foreground)]">
          {customConfig ? 'Your saved setup' : 'Edit below, then swipe back to save'}
        </p>
        <p className="text-sm font-semibold">
          {customPreview.sets}×{customPreview.fastSec / 60}/{customPreview.slowSec / 60} min · ~{presetTotalMin(customPreview)} min total
        </p>
      </div>,
    ]
  }, [customConfig, recommendation, prescribed])

  return (
    <div className="flex flex-col gap-4 px-6 pt-safe pb-safe-action-lg">
      <h2 className="text-2xl font-bold">Interval walk</h2>
      <p className="text-sm text-muted-foreground">
        Alternate fast and slow blocks. The classic method is 3 min fast / 3 min slow, repeated.
      </p>

      <div className="space-y-2.5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
          Today’s walk · swipe to override
        </p>

        <SwipeCarousel index={presetIndex} onIndexChange={applyPreset} className="h-24">
          {slides}
        </SwipeCarousel>

        <CarouselDots
          count={PRESET_DOT_LABELS.length}
          activeIndex={presetIndex}
          onSelect={applyPreset}
          label={i => PRESET_DOT_LABELS[i]}
          activeColor="var(--accent-cyan)"
          inactiveColor={() => 'var(--border)'}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Sets" value={config.sets} min={1} max={12} onChange={v => setConfig({ sets: v })} />
        <NumberField label="Fast (min)" value={config.fastSec / 60} min={1} max={10} onChange={v => setConfig({ fastSec: v * 60 })} />
        <NumberField label="Slow (min)" value={config.slowSec / 60} min={1} max={10} onChange={v => setConfig({ slowSec: v * 60 })} />
        <NumberField label="Warm-up (min)" value={config.warmupSec / 60} min={0} max={10} onChange={v => setConfig({ warmupSec: v * 60 })} />
        <NumberField label="Cool-down (min)" value={config.cooldownSec / 60} min={0} max={10} onChange={v => setConfig({ cooldownSec: v * 60 })} />
      </div>

      {/* The pacing targets. A pair rather than one number, because a slow block is not an unpaced
          rest — walking it too hard is what stops the fast block being fast (owner, Q-410). */}
      <div className="space-y-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
          Step-rate targets
        </p>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Fast spm ≥" value={cadenceTargets.fast} min={60} max={200} step={5}
            onChange={v => setConfig({ fastCadenceSpm: v })} />
          <NumberField label="Slow spm ≤" value={cadenceTargets.slow} min={40} max={160} step={5}
            onChange={v => setConfig({ slowCadenceSpm: v })} />
        </div>
        <p className="text-xs text-muted-foreground">
          The walk paces you against these. Needs a chest strap for step rate — without one it paces
          by speed, and by heart rate indoors.
        </p>
      </div>

      {/* Treadmill mode. Indoor GPS is multipath noise, so it is skipped entirely rather than
          recorded and thrown away — a walk carrying a fabricated distance would drag pace
          aggregates around. `=== true` on purpose: a config persisted before this field existed
          rehydrates without it, and undefined must read as "off" (today's behaviour). */}
      <label className="flex items-center justify-between rounded-lg border border-border p-3">
        <span className="flex items-center gap-2">
          <FootprintsIcon className="h-4 w-4 flex-none text-muted-foreground" />
          <span>
            <span className="block text-sm font-medium">Treadmill</span>
            <span className="block text-xs text-muted-foreground">Skips GPS — no distance or pace recorded</span>
          </span>
        </span>
        <Switch
          checked={config.treadmill === true}
          onCheckedChange={v => { hapticLight(); setConfig({ treadmill: v }) }}
          aria-label="Treadmill mode"
        />
      </label>

      <p className="text-sm text-muted-foreground">Total: ~{totalMin} min</p>
      <Button className="h-12" onClick={onStart}>Start walk</Button>

      {segmentStats && <WalkSegmentStatsCard fast={segmentStats.fast} slow={segmentStats.slow} />}
    </div>
  )
}

function NumberField({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
      <div className="flex items-center gap-1">
        <button type="button" aria-label={`decrease ${label}`} className="h-12 w-12 rounded-lg border border-border text-lg"
          onClick={() => onChange(Math.max(min, value - step))}>−</button>
        <span className="flex-1 text-center text-base font-bold tabular-nums text-foreground">{value}</span>
        <button type="button" aria-label={`increase ${label}`} className="h-12 w-12 rounded-lg border border-border text-lg"
          onClick={() => onChange(Math.min(max, value + step))}>+</button>
      </div>
    </label>
  )
}
