'use client'

import { motion } from 'motion/react'
import { MuscleHeatmap } from '@/components/muscle-heatmap'
import { MuscleRecoveryCard } from '@/components/workout/muscle-recovery-card'
import { accentCardStyle } from '@trainingai/shared/utils'
import type { MuscleSetsEntry } from '@/app/api/weekly-muscle-sets/route'
import type { MuscleRecoveryEntry } from '@/app/api/muscle-recovery/route'

/**
 * Body-tab hero: a compact front/back muscle map of what's been trained this week
 * (volume-tinted) plus the live recovery strip. Deliberately smaller than the Training
 * tab's full "Muscle Volume This Week" card — this is the at-a-glance "what am I working"
 * headline for the Body screen.
 */
export function BodyMuscleCard({
  muscleSets,
  recoveryMuscles,
  gender = 'male',
}: {
  muscleSets: MuscleSetsEntry[] | null
  recoveryMuscles: MuscleRecoveryEntry[]
  gender?: 'male' | 'female'
}) {
  const worked = (muscleSets ?? []).filter(m => m.sets > 0)
  const topWorked = [...worked].sort((a, b) => b.sets - a.sets).slice(0, 3)

  return (
    <div className="rounded-2xl p-4" style={accentCardStyle('#22c55e')}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Muscles Worked · This Week
        </h3>
        {topWorked.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            Top: <span className="font-semibold text-foreground capitalize">{topWorked.map(m => m.muscle).join(', ')}</span>
          </span>
        )}
      </div>

      {worked.length === 0 ? (
        <div className="py-3">
          <p className="text-sm font-semibold text-foreground">No sets logged yet this week</p>
          <p className="text-xs text-muted-foreground mt-0.5">Train a session to light up the map</p>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="mx-auto max-w-[220px]"
        >
          <MuscleHeatmap volumes={worked} compact gender={gender} />
        </motion.div>
      )}

      {recoveryMuscles.length > 0 && (
        <div className="mt-2">
          <MuscleRecoveryCard muscles={recoveryMuscles} />
        </div>
      )}
    </div>
  )
}
