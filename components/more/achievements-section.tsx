"use client"

import { ChevronRight, Loader2 } from 'lucide-react'
import { AchievementsGrid, AchievementBadges, type AchievementResult } from '@/components/profile/achievements-grid'
import { motion, AnimatePresence } from 'motion/react'

interface AchievementsSectionProps {
  achievementsLoading: boolean
  achievements: AchievementResult[] | null
  showAllAchievements: boolean
  setShowAllAchievements: (v: boolean | ((prev: boolean) => boolean)) => void
  unlockedCount: number
  totalAchievements: number
  recentUnlocked: AchievementResult[]
}

export function AchievementsSection({
  achievementsLoading,
  achievements,
  showAllAchievements,
  setShowAllAchievements,
  unlockedCount,
  totalAchievements,
  recentUnlocked,
}: AchievementsSectionProps) {
  return (
    <div>
      <button
        type="button"
        onClick={() => setShowAllAchievements(v => !v)}
        aria-expanded={showAllAchievements}
        className="flex w-full items-center justify-between px-1 pb-2"
      >
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Achievements</p>
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold" style={{ color: 'var(--color-brand)' }}>
            {unlockedCount} / {totalAchievements}
          </p>
          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showAllAchievements ? 'rotate-90' : ''}`} />
        </div>
      </button>
      {achievementsLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : achievements ? (
        <AnimatePresence mode="wait">
          {showAllAchievements ? (
            <motion.div
              key="full"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
            >
              <button
                type="button"
                onClick={() => setShowAllAchievements(false)}
                className="w-full mb-3 rounded-xl px-3 py-2 text-xs font-semibold border border-border hover:bg-muted/60 transition text-muted-foreground"
              >
                ← Collapse
              </button>
              <AchievementsGrid achievements={achievements} />
            </motion.div>
          ) : (
            <motion.div
              key="preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {recentUnlocked.length === 0 ? (
                <p className="px-4 py-4 text-xs text-muted-foreground rounded-2xl bg-muted/40 border border-border">Complete your first workout to earn achievements!</p>
              ) : (
                <AchievementBadges achievements={recentUnlocked} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">Could not load achievements</p>
      )}
    </div>
  )
}
