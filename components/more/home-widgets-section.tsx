"use client"

import { useEffect, useState } from 'react'
import {
  LayoutGrid, ChevronDown, Star, Activity, CalendarDays, BarChart2,
  Scale, Footprints, Flame, Route, Beef, Wheat, Droplets, TrendingUp, Apple, Moon, MessageCircle,
  Heart, Dumbbell, Check,
  type LucideIcon,
} from 'lucide-react'
import { ColorSwatchPicker } from '@/components/ui/color-swatch-picker'
import { SCORE_RING_STYLE_KEY, SCORE_RING_STYLES, SCORE_RING_STYLE_CHANGE_EVENT, loadScoreRingStyle, type ScoreRingStyle } from '@/lib/home/home-prefs'

type MetaKey = "weightKg" | "steps" | "calories" | "protein" | "carb" | "fat" | "distanceKm" | "waterIntake"
type CardWidgetKey =
  | "weightSparkline" | "nutritionDonut" | "sleepWidget" | "stepsWidget" | "moodWidget"
  | "acwrWidget" | "muscleStatusWidget" | "hrChartWidget" | "energyBalanceWidget"
type HomeSectionKey = "recommendation" | "streak" | "weekStrip" | "metricTiles"

const WIDGETS_KEY         = "ta_ss_widgets"
const CARD_WIDGETS_KEY    = "ta_ss_cards"
const PILL_COLORS_KEY     = "ta_pill_colors"
const CARD_COLORS_KEY     = "ta_card_colors"
const HIDDEN_SECTIONS_KEY = "ta_home_hidden_sections"
const WEIGHT_LOOKBACK_KEY = "ta_weight_lookback"

const DEFAULT_WIDGETS: MetaKey[] = ["weightKg", "steps", "calories"]

const CARD_DEFAULT_COLORS: Record<CardWidgetKey, string> = {
  weightSparkline:    '#00d4ff',
  nutritionDonut:     '#bf5fff',
  sleepWidget:        '#8b5cf6',
  stepsWidget:        '#2dd4bf',
  moodWidget:         '#fbbf24',
  acwrWidget:         '#f59e0b',
  muscleStatusWidget: '#22c55e',
  hrChartWidget:      'transparent',
  energyBalanceWidget: '#22c55e',
}

const HOME_SECTION_DEFS: { key: HomeSectionKey; label: string; icon: LucideIcon }[] = [
  { key: "recommendation", label: "Today's Recommendation", icon: Star        },
  { key: "streak",         label: "Streak & This Week",     icon: Activity     },
  { key: "weekStrip",      label: "Week Strip",             icon: CalendarDays },
  { key: "metricTiles",    label: "Metric Tiles",           icon: BarChart2    },
]

const CARD_WIDGET_DEFS: { key: CardWidgetKey; label: string; icon: LucideIcon }[] = [
  { key: "weightSparkline",    label: "Weight Trend",  icon: TrendingUp    },
  { key: "nutritionDonut",     label: "Nutrition",     icon: Apple         },
  { key: "sleepWidget",        label: "Sleep",         icon: Moon          },
  { key: "stepsWidget",        label: "Steps",         icon: Footprints    },
  { key: "moodWidget",         label: "Readiness",     icon: MessageCircle },
  { key: "acwrWidget",         label: "ACWR",          icon: BarChart2     },
  { key: "muscleStatusWidget", label: "Muscle Status", icon: Dumbbell      },
  { key: "hrChartWidget",      label: "HR Chart",      icon: Heart         },
  { key: "energyBalanceWidget", label: "Energy Balance", icon: Flame        },
]

const WIDGET_DEFS: { key: MetaKey; label: string; icon: LucideIcon; color: string }[] = [
  { key: "weightKg",    label: "Body Weight", icon: Scale,      color: "#00d4ff" },
  { key: "steps",       label: "Steps",       icon: Footprints, color: "#22c55e" },
  { key: "calories",    label: "Calories",    icon: Flame,      color: "#f97316" },
  { key: "distanceKm",  label: "Distance",    icon: Route,      color: "#2dd4bf" },
  { key: "protein",     label: "Protein",     icon: Beef,       color: "#f43f5e" },
  { key: "carb",        label: "Carbs",       icon: Wheat,      color: "#f59e0b" },
  { key: "fat",         label: "Fat",         icon: Droplets,   color: "#a78bfa" },
  { key: "waterIntake", label: "Water",       icon: Droplets,   color: "#38bdf8" },
]

function loadPillColors(): Record<string, string> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(PILL_COLORS_KEY) : null
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function loadCardColors(): Record<string, string> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(CARD_COLORS_KEY) : null
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function loadHiddenSections(): Set<HomeSectionKey> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(HIDDEN_SECTIONS_KEY) : null
    return raw ? new Set(JSON.parse(raw) as HomeSectionKey[]) : new Set()
  } catch { return new Set() }
}

function Divider() {
  return <div className="h-px bg-border mx-4" />
}

export function HomeWidgetsSection() {
  const [expanded, setExpanded] = useState(false)
  const [homeWidgets, setHomeWidgets] = useState<MetaKey[]>(DEFAULT_WIDGETS)
  const [pillColors, setPillColors] = useState<Record<string, string>>(() => loadPillColors())
  const [cardColors, setCardColors] = useState<Record<string, string>>(() => loadCardColors())
  const [homeCardWidgets, setHomeCardWidgets] = useState<CardWidgetKey[]>([])
  const [hiddenSections, setHiddenSections] = useState<Set<HomeSectionKey>>(() => new Set())
  const [weightLookback, setWeightLookback] = useState<7 | 30>(7)
  const [scoreRingStyle, setScoreRingStyle] = useState<ScoreRingStyle>('default')

  useEffect(() => {
    try {
      const w = localStorage.getItem(WIDGETS_KEY)
      if (w) setHomeWidgets(JSON.parse(w))
      const c = localStorage.getItem(CARD_WIDGETS_KEY)
      if (c) setHomeCardWidgets(JSON.parse(c))
      const lb = localStorage.getItem(WEIGHT_LOOKBACK_KEY)
      if (lb === '30') setWeightLookback(30)
      setHiddenSections(loadHiddenSections())
      setScoreRingStyle(loadScoreRingStyle())
    } catch { /* ignore */ }
  }, [])

  function toggleHomeWidget(key: MetaKey) {
    setHomeWidgets(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      localStorage.setItem(WIDGETS_KEY, JSON.stringify(next))
      return next
    })
  }

  function toggleHomeCardWidget(key: CardWidgetKey) {
    setHomeCardWidgets(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      localStorage.setItem(CARD_WIDGETS_KEY, JSON.stringify(next))
      return next
    })
  }

  function toggleHiddenSection(key: HomeSectionKey) {
    setHiddenSections(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      localStorage.setItem(HIDDEN_SECTIONS_KEY, JSON.stringify([...next]))
      return next
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-4 py-3.5 hover:bg-muted/60 transition"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "color-mix(in oklab, var(--color-brand) 15%, var(--color-muted))" }}
          >
            <LayoutGrid className="h-4 w-4" style={{ color: "var(--color-brand)" }} />
          </div>
          <div>
            <p className="text-sm font-semibold text-left">Home Widgets</p>
            <p className="text-[10px] text-muted-foreground">Card widgets, metric tiles, sparklines</p>
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="border-t border-border">
          {/* Home Sections */}
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground mb-2">Home Sections</p>
            <div className="flex gap-2 flex-wrap">
              {HOME_SECTION_DEFS.map(def => {
                const visible = !hiddenSections.has(def.key)
                return (
                  <button
                    key={def.key}
                    type="button"
                    onClick={() => toggleHiddenSection(def.key)}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium border transition ${
                      visible
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-border bg-muted text-muted-foreground line-through opacity-60'
                    }`}
                  >
                    <def.icon className="h-4 w-4" />
                    <span>{def.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Card Widgets */}
          <Divider />
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground mb-2">Card Widgets</p>
            <div className="flex gap-2 flex-wrap">
              {CARD_WIDGET_DEFS.map(def => {
                const currentColor = cardColors[def.key] ?? CARD_DEFAULT_COLORS[def.key]
                return (
                  <div key={def.key} className="flex items-center gap-1">
                    <ColorSwatchPicker
                      value={currentColor}
                      label={def.label}
                      className="w-6 h-6 shadow-sm"
                      onChange={hex => {
                        const next = { ...cardColors, [def.key]: hex }
                        setCardColors(next)
                        localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next))
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => toggleHomeCardWidget(def.key)}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium border transition ${
                        homeCardWidgets.includes(def.key)
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-border bg-muted text-muted-foreground'
                      }`}
                    >
                      <def.icon className="h-4 w-4" />
                      <span>{def.label}</span>
                    </button>
                    {cardColors[def.key] && (
                      <button
                        className="text-[10px] text-muted-foreground underline flex-none"
                        onClick={() => {
                          const next = { ...cardColors }
                          delete next[def.key]
                          setCardColors(next)
                          localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next))
                        }}
                      >
                        reset
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Metric Tiles */}
          <Divider />
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground mb-2">Metric Tiles</p>
            <div className="flex gap-2 flex-wrap">
              {WIDGET_DEFS.map(def => (
                <div key={def.key} className="flex items-center gap-1">
                  <ColorSwatchPicker
                    value={pillColors[def.key] ?? def.color}
                    label={`${def.label} tile`}
                    className="w-6 h-6 shadow-sm"
                    onChange={hex => {
                      const next = { ...pillColors, [def.key]: hex }
                      setPillColors(next)
                      localStorage.setItem(PILL_COLORS_KEY, JSON.stringify(next))
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => toggleHomeWidget(def.key)}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium border transition ${
                      homeWidgets.includes(def.key)
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-border bg-muted text-muted-foreground'
                    }`}
                  >
                    <def.icon className="h-4 w-4" />
                    <span>{def.label}</span>
                  </button>
                  {pillColors[def.key] && (
                    <button
                      className="text-[10px] text-muted-foreground underline flex-none"
                      onClick={() => {
                        const next = { ...pillColors }
                        delete next[def.key]
                        setPillColors(next)
                        localStorage.setItem(PILL_COLORS_KEY, JSON.stringify(next))
                      }}
                    >
                      reset
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Weight Sparkline lookback */}
          <Divider />
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium">Weight Sparkline</p>
              <p className="text-xs text-muted-foreground">Days of history shown</p>
            </div>
            <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold border border-border">
              <button
                type="button"
                onClick={() => { setWeightLookback(7); localStorage.setItem(WEIGHT_LOOKBACK_KEY, '7') }}
                className={`rounded-lg px-3 py-1.5 transition ${weightLookback === 7 ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
              >7d</button>
              <button
                type="button"
                onClick={() => { setWeightLookback(30); localStorage.setItem(WEIGHT_LOOKBACK_KEY, '30') }}
                className={`rounded-lg px-3 py-1.5 transition ${weightLookback === 30 ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
              >30d</button>
            </div>
          </div>

          {/* Score-card ring style */}
          <Divider />
          <div className="px-4 py-3">
            <p className="text-sm font-medium">Score Card Style</p>
            <p className="text-xs text-muted-foreground mb-2">Frame for the four home score circles</p>
            <div role="radiogroup" aria-label="Score card style" className="flex flex-col gap-1.5">
              {SCORE_RING_STYLES.map(opt => {
                const active = scoreRingStyle === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setScoreRingStyle(opt.value)
                      localStorage.setItem(SCORE_RING_STYLE_KEY, opt.value)
                      window.dispatchEvent(new Event(SCORE_RING_STYLE_CHANGE_EVENT))
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                      active ? 'border-brand bg-brand/10' : 'border-border bg-muted'
                    }`}
                  >
                    <div>
                      <p className={`text-sm font-medium ${active ? 'text-brand' : 'text-foreground'}`}>{opt.label}</p>
                      <p className="text-xs text-muted-foreground">{opt.description}</p>
                    </div>
                    {active && <Check className="h-4 w-4 flex-none text-brand" />}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
