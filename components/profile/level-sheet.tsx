'use client'

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import type { AchievementResult } from './achievements-grid'

const LEVEL_THRESHOLDS = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5800, 8000]
const LEVEL_LABELS = ['', 'Novice', 'Novice', 'Beginner', 'Beginner', 'Intermediate', 'Intermediate', 'Advanced', 'Advanced', 'Elite', 'Elite', 'Legend']

interface LevelSheetProps {
  level: number
  xp: number
  currentLevelXp: number
  nextLevelXp: number
  achievements: AchievementResult[]
  children: ReactNode
}

export function LevelSheet({ level, xp, currentLevelXp, nextLevelXp, achievements, children }: LevelSheetProps) {
  const xpProgress = nextLevelXp > currentLevelXp
    ? Math.min(1, (xp - currentLevelXp) / (nextLevelXp - currentLevelXp))
    : 1

  const unlockedAchievements = achievements.filter(a => a.unlocked).sort((a, b) => b.xpReward - a.xpReward)

  const currentLevelRef = useRef<HTMLDivElement>(null)

  function handleOpenChange(open: boolean) {
    if (!open) return
    // Auto-scroll to current level after sheet animation completes
    const timer = setTimeout(() => {
      currentLevelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 300)
    // Cleanup is best-effort — sheet component doesn't await this
    void timer
  }

  return (
    <Sheet onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-0">
        <SheetHeader className="px-4 pb-3 border-b border-border">
          <SheetTitle>Level &amp; XP</SheetTitle>
        </SheetHeader>

        <div className="px-4 py-4 space-y-6">
          {/* Current level hero */}
          <div className="flex flex-col items-center gap-3">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black"
              style={{ background: "var(--color-brand)", color: "var(--brand-foreground)", boxShadow: "0 0 24px var(--color-brand)" }}
            >
              {level}
            </div>
            <div className="text-center">
              <p className="text-lg font-bold" style={{ color: "var(--color-brand)" }}>
                Level {level} · {LEVEL_LABELS[level] ?? 'Legend'}
              </p>
              <p className="text-sm text-muted-foreground">{xp} XP total</p>
            </div>
            <div className="w-full max-w-xs">
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                <span>{xp - currentLevelXp} XP</span>
                <span>{nextLevelXp - currentLevelXp} XP to Level {level + 1}</span>
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(xpProgress * 100)}%`,
                    background: "var(--color-brand)",
                    boxShadow: "0 0 6px var(--color-brand)",
                    transition: "width 0.6s ease",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Level thresholds */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">All Levels</p>
            <div className="space-y-2">
              {LEVEL_THRESHOLDS.map((threshold, i) => {
                const lvl = i + 1
                const isCurrentLevel = lvl === level
                const isPast = lvl < level
                return (
                  <div
                    key={lvl}
                    ref={isCurrentLevel ? currentLevelRef : undefined}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-all"
                    style={{
                      background: isCurrentLevel ? "color-mix(in oklch, var(--color-brand) 10%, transparent)" : "transparent",
                      borderColor: isCurrentLevel ? "var(--color-brand)" : "var(--border)",
                      opacity: isPast ? 0.55 : 1,
                    }}
                  >
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black flex-none"
                      style={{
                        background: isPast || isCurrentLevel ? "var(--color-brand)" : "var(--color-muted)",
                        color: isPast || isCurrentLevel ? "#000" : "var(--color-muted-foreground)",
                        opacity: isPast ? 0.6 : 1,
                      }}
                    >
                      {lvl}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{LEVEL_LABELS[lvl] ?? 'Legend'}</p>
                      <p className="text-[10px] text-muted-foreground">{threshold.toLocaleString()} XP</p>
                    </div>
                    {isCurrentLevel && (
                      <span
                        className="text-[10px] font-bold rounded-lg px-2 py-1"
                        style={{ background: "var(--color-brand)", color: "var(--brand-foreground)" }}
                      >
                        Current
                      </span>
                    )}
                    {isPast && (
                      <span className="text-[10px] text-muted-foreground">✓</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* XP earned breakdown */}
          {unlockedAchievements.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                XP Sources ({unlockedAchievements.length} unlocked)
              </p>
              <div className="space-y-1.5">
                {unlockedAchievements.map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 text-muted-foreground truncate">{a.name}</span>
                    <span className="font-semibold tabular-nums" style={{ color: "var(--color-brand)" }}>+{a.xpReward}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
