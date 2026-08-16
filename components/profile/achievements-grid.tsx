'use client'

import type { ComponentType, CSSProperties } from 'react'
import { useEffect, useRef } from 'react'
import {
  Dumbbell, TrendingUp, RotateCcw, Zap, Trophy, Crown,
  Building2, Diamond, Shield, Rocket, Target, Activity,
  Flame, Star, Sunrise, Moon, Calendar, CalendarDays, CalendarCheck,
  Leaf, Utensils, Heart, CheckCircle2, Bed, BarChart2, LineChart,
  ArrowDown, Swords, Timer, Sun, Lock,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const SEEN_KEY = 'ta_seen_achievements'

function getSeenIds(): string[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(SEEN_KEY) : null
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function markSeen(ids: string[]) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids)) } catch { /* ignore */ }
}

type BadgeTier = 'bronze' | 'silver' | 'gold'

function getBadgeTier(xpReward: number): BadgeTier {
  if (xpReward >= 200) return 'gold'
  if (xpReward >= 50) return 'silver'
  return 'bronze'
}

const TIER_BORDER: Record<BadgeTier, string> = {
  bronze: '#cd7c2e',
  silver: '#9ca3af',
  gold:   '#f59e0b',
}

const TIER_GLOW: Record<BadgeTier, string> = {
  bronze: '0 0 8px rgba(205,124,46,0.4)',
  silver: '0 0 8px rgba(156,163,175,0.3)',
  gold:   '0 0 12px rgba(245,158,11,0.5), 0 0 24px rgba(245,158,11,0.2)',
}

export interface AchievementResult {
  id: string
  name: string
  description: string
  icon: string
  category: string
  xpReward: number
  unlocked: boolean
  progress: number
  goal: number
  current: number
}

interface AchievementsGridProps {
  achievements: AchievementResult[]
  onlyUnlocked?: boolean
}

export type LucideIcon = ComponentType<{ className?: string; style?: CSSProperties }>

export const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  first_session:   Dumbbell,
  sessions_10:     TrendingUp,
  sessions_25:     RotateCcw,
  sessions_50:     Zap,
  sessions_100:    Trophy,
  sessions_250:    Crown,
  volume_1k:       Building2,
  volume_10k:      Diamond,
  volume_50k:      Shield,
  volume_100k:     Rocket,
  volume_500k:     Zap,
  sets_100:        Target,
  sets_1000:       Dumbbell,
  sets_5000:       Activity,
  streak_7:        Flame,
  streak_14:       Star,
  streak_30:       Sun,
  streak_60:       Swords,
  first_pr:        Trophy,
  prs_5:           Target,
  prs_10:          Diamond,
  prs_25:          Zap,
  early_bird:      Sunrise,
  early_bird_5:    Sun,
  night_owl:       Moon,
  months_3:        Calendar,
  months_6:        CalendarDays,
  months_12:       CalendarCheck,
  food_first:      Leaf,
  food_streak_7:   Utensils,
  food_streak_30:  Heart,
  calorie_goal_7:  Target,
  calorie_goal_30: CheckCircle2,
  sleep_first:     Bed,
  sleep_streak_7:  Moon,
  sleep_streak_30: Bed,
  weight_first:    BarChart2,
  weight_30:       LineChart,
  squat_100:       Dumbbell,
  bench_100:       Activity,
  deadlift_100:    ArrowDown,
}

export const CATEGORY_COLORS: Record<string, string> = {
  'Workouts':        'var(--color-brand)',
  'Volume':          '#ff6a1a',
  'Sets':            '#00d4ff',
  'Streaks':         '#f59e0b',
  'Records':         '#a855f7',
  'Timing':          '#ec4899',
  'Consistency':     '#10b981',
  'Nutrition':       '#84cc16',
  'Sleep':           '#6366f1',
  'Body Metrics':    '#14b8a6',
  'Lift Milestones': '#ef4444',
}

const CATEGORY_ORDER = [
  'Workouts',
  'Volume',
  'Sets',
  'Streaks',
  'Records',
  'Timing',
  'Consistency',
  'Nutrition',
  'Sleep',
  'Body Metrics',
  'Lift Milestones',
]

function BadgeCard({ achievement, isNew = false, rarityLabel }: { achievement: AchievementResult; isNew?: boolean; rarityLabel?: string }) {
  const { id, unlocked, progress, name, description, xpReward, category, goal, current } = achievement
  const Icon = ACHIEVEMENT_ICONS[id] ?? Dumbbell
  const color = CATEGORY_COLORS[category] ?? 'var(--color-brand)'
  const showProgress = !unlocked && progress > 0
  const tier = unlocked ? getBadgeTier(xpReward) : null
  const borderColor = tier ? TIER_BORDER[tier] : undefined
  const glow = tier ? TIER_GLOW[tier] : undefined

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`relative flex flex-col items-center justify-center rounded-2xl border p-2 aspect-square overflow-hidden transition-transform active:scale-95 w-full ${isNew ? 'shimmer-sweep' : ''}`}
          style={
            unlocked
              ? {
                  background: `color-mix(in oklab, ${color} 12%, var(--color-background))`,
                  borderColor: borderColor ?? color,
                  boxShadow: glow ?? `0 0 10px color-mix(in oklch, ${color} 25%, transparent)`,
                  borderWidth: tier === 'gold' ? '2px' : '1px',
                }
              : {
                  background: 'var(--muted)',
                  borderColor: 'var(--border)',
                }
          }
        >
          {/* Tier label */}
          {tier === 'gold' && (
            <div className="absolute top-1 left-1 text-[7px] font-bold uppercase tracking-wider px-1 py-0.5 rounded-sm" style={{ color: TIER_BORDER.gold, background: 'rgba(245,158,11,0.15)' }}>
              Gold
            </div>
          )}

          {/* Background glow for unlocked */}
          {unlocked && (
            <div
              className="absolute inset-0 opacity-10 blur-md pointer-events-none"
              style={{ background: color }}
            />
          )}

          <Icon
            className="h-8 w-8 mb-1.5 relative flex-none"
            style={{
              color: unlocked ? color : 'var(--muted-foreground)',
              filter: unlocked ? `drop-shadow(0 0 4px ${color})` : 'none',
            }}
          />

          <p
            className="text-center text-[10px] font-semibold leading-tight line-clamp-2 px-0.5 relative"
            style={{ color: unlocked ? color : 'var(--muted-foreground)' }}
          >
            {name}
          </p>

          {!unlocked && (
            <div className="absolute top-1.5 right-1.5 opacity-30">
              <Lock className="h-2.5 w-2.5 text-foreground" />
            </div>
          )}

          {showProgress && (
            <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/5 overflow-hidden">
              <div
                className="h-full"
                style={{ width: `${Math.round(progress * 100)}%`, background: color }}
              />
            </div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-4" side="top" sideOffset={8}>
        <div className="flex items-center justify-between mb-1">
          <p className="font-bold text-sm" style={{ color }}>{name}</p>
          {tier && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase"
              style={{ color: TIER_BORDER[tier], background: `${TIER_BORDER[tier]}20` }}>
              {tier}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{description}</p>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-semibold tabular-nums">
              {Math.min(current, goal).toLocaleString()} / {goal.toLocaleString()}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.round(progress * 100)}%`, background: color }}
            />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Reward</span>
          <span className="font-bold" style={{ color }}>+{xpReward} XP</span>
        </div>
        {rarityLabel && (
          <p className="mt-2 text-[10px] text-muted-foreground">{rarityLabel}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Flat 4-column grid with no category headers — used for the collapsed preview. */
export function AchievementBadges({ achievements }: { achievements: AchievementResult[] }) {
  if (achievements.length === 0) return null
  return (
    <div className="grid grid-cols-4 gap-2.5">
      {achievements.map(a => (
        <BadgeCard key={a.id} achievement={a} />
      ))}
    </div>
  )
}

export function AchievementsGrid({ achievements, onlyUnlocked = false }: AchievementsGridProps) {
  const seenRef = useRef<string[]>([])
  const newIds = useRef<Set<string>>(new Set())

  // Determine newly-unlocked badges on first render
  useEffect(() => {
    const seen = getSeenIds()
    seenRef.current = seen
    const currentlyUnlocked = achievements.filter(a => a.unlocked).map(a => a.id)
    const newOnes = currentlyUnlocked.filter(id => !seen.includes(id))
    newIds.current = new Set(newOnes)
    if (newOnes.length > 0) {
      markSeen([...seen, ...newOnes])
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const byCategory = CATEGORY_ORDER.reduce<Record<string, AchievementResult[]>>((acc, cat) => {
    const items = achievements.filter(a => a.category === cat)
    if (items.length > 0) acc[cat] = items
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {Object.entries(byCategory).map(([category, items]) => {
        const visible = onlyUnlocked ? items.filter(a => a.unlocked) : items
        if (visible.length === 0) return null
        const unlockedCount = items.filter(a => a.unlocked).length

        return (
          <div key={category}>
            <div className="flex items-center justify-between mb-2 px-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {category}
              </p>
              <p className="text-[10px] font-semibold text-muted-foreground">
                {unlockedCount} / {items.length}
              </p>
            </div>

            <div className="grid grid-cols-4 gap-2.5">
              {visible.map(a => (
                <BadgeCard key={a.id} achievement={a} isNew={newIds.current.has(a.id)} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
