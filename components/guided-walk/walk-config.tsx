'use client'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { FootprintsIcon } from 'lucide-react'
import { SwipeCarousel } from '@/components/ui/swipe-carousel'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import { buildIntervalPlan } from '@/lib/walk/interval-plan'
import { hapticLight } from '@/lib/haptics'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { WALK_SEGMENT_STATS_TTL } from '@trainingai/shared/cache-ttl'
import { WalkSegmentStatsCard } from './walk-segment-stats-card'
import type { KindAggregate } from '@/lib/walk/segment-stats'
import { DEFAULT_WALK_CONFIG } from '@/lib/walk/interval-plan'
import { CarouselDots } from '@/components/ui/carousel-dots'

const PRESETS = [
  { label: 'Long', blurb: 'The classic method, repeated', sets: 5, fastSec: 180, slowSec: 180 },
  { label: 'Short', blurb: 'Shorter session, same rhythm', sets: 3, fastSec: 180, slowSec: 180 },
]

// Not a preset in PRESETS — Custom has no fixed sets/fast/slow to match against, it's
// whatever the lifter last saved (or DEFAULT_WALK_CONFIG if they never have).
const CUSTOM_INDEX = PRESETS.length
const PRESET_DOT_LABELS = [...PRESETS.map(p => p.label), 'Custom']

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

  // All-time fast/slow block stats across past interval walks — not date-scoped (like
  // running-bests), so the plain (non-today) cache variant.
  const [segmentStats, setSegmentStats] = useState<SegmentStats | null>(null)
  useEffect(() => {
    const seed = readCacheSync<SegmentStats>('walk-segment-stats')
    if (seed) setSegmentStats(seed)
    cachedFetch<SegmentStats>('walk-segment-stats', '/api/guided-walk/segment-stats', WALK_SEGMENT_STATS_TTL, setSegmentStats).catch(() => {})
  }, [])

  // Which slide is selected is real state, not purely derived from config content — Custom's
  // "not set up yet" fallback (DEFAULT_WALK_CONFIG) happens to have the exact same
  // sets/fast/slow as the Long preset, so a pure content match would immediately snap a fresh
  // Custom selection straight back to "Long selected". Seeded once from content on mount (so a
  // reload still shows the right slide), then only moves in two ways below: an explicit tap/
  // swipe, or a stepper edit that no longer matches the currently selected Long/Short preset.
  const [presetIndex, setPresetIndex] = useState(() => {
    const idx = PRESETS.findIndex(p => p.sets === config.sets && p.fastSec === config.fastSec && p.slowSec === config.slowSec)
    return idx >= 0 ? idx : CUSTOM_INDEX
  })

  // Fix for the pre-Q-99 bug: editing a stepper while Long/Short is selected used to leave the
  // carousel silently claiming "Long selected" even though the values no longer matched — flip
  // to Custom instead. Also the autosave: while Custom is selected, keep the persisted
  // `customConfig` in sync with every edit, so it survives switching to Long/Short and back
  // without a separate "Save as Custom" step.
  useEffect(() => {
    if (presetIndex < PRESETS.length) {
      const p = PRESETS[presetIndex]
      if (p.sets !== config.sets || p.fastSec !== config.fastSec || p.slowSec !== config.slowSec) {
        // The edit that just triggered this flip IS the custom config — save it in the same
        // pass. Deferring to a future config change would never fire if the user doesn't touch
        // another stepper, leaving the Custom slide's preview stuck on stale values.
        setPresetIndex(CUSTOM_INDEX)
        setCustomConfig(config)
      }
    } else {
      setCustomConfig(config)
    }
    // Only re-run on config changes — presetIndex is written here, not read as an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  const applyPreset = (index: number) => {
    hapticLight()
    setPresetIndex(index)
    if (index === CUSTOM_INDEX) {
      setConfig(customConfig ?? DEFAULT_WALK_CONFIG)
      return
    }
    const p = PRESETS[index]
    setConfig({ sets: p.sets, fastSec: p.fastSec, slowSec: p.slowSec })
  }

  const slides = useMemo(() => {
    const customPreview = customConfig ?? DEFAULT_WALK_CONFIG
    return [
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
  }, [customConfig])

  return (
    <div className="flex flex-col gap-4 px-6 pt-safe pb-safe-action-lg">
      <h2 className="text-2xl font-bold">Interval walk</h2>
      <p className="text-sm text-muted-foreground">
        Alternate fast and slow blocks. The classic method is 3 min fast / 3 min slow, repeated.
      </p>

      <div className="space-y-2.5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
          Swipe to pick a preset
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

function NumberField({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
      <div className="flex items-center gap-1">
        <button type="button" aria-label={`decrease ${label}`} className="h-12 w-12 rounded-lg border border-border text-lg"
          onClick={() => onChange(Math.max(min, value - 1))}>−</button>
        <span className="flex-1 text-center text-base font-bold tabular-nums text-foreground">{value}</span>
        <button type="button" aria-label={`increase ${label}`} className="h-12 w-12 rounded-lg border border-border text-lg"
          onClick={() => onChange(Math.min(max, value + 1))}>+</button>
      </div>
    </label>
  )
}
