import type { WorkoutSession } from '@trainingai/shared/types/log'
import type { ExerciseLibraryEntry } from '@trainingai/shared/types/program'
import type { MuscleRecovery } from './ai-dynamic'
import { normalizeMuscle } from '@trainingai/shared/muscles'

// A bigger bout than usual takes proportionally longer to recover from — the time
// constant scales with how this bout's volume compares to the muscle's typical (median)
// bout volume, clamped to 16-48h so a token single-set touch doesn't "recover" instantly
// and a huge outlier bout doesn't stall recovery forever.
export function computeMuscleRecovery(
  sessions: WorkoutSession[],
  library: Pick<ExerciseLibraryEntry, 'name' | 'muscles'>[],
  opts?: { now?: number },
): MuscleRecovery[] {
  const libByName = new Map(library.map(e => [e.name.toLowerCase(), e]))
  const muscleBouts = new Map<string, { trainedMs: number; volumeKg: number }[]>()

  for (const ws of sessions) {
    const trainedMs = ws.startedAt.getTime()
    const volumeByMuscle = new Map<string, number>()
    for (const ex of ws.exercises) {
      const entry = libByName.get(ex.exerciseName.toLowerCase())
      if (!entry) continue
      for (const m of entry.muscles) {
        if (m.role !== 'main') continue
        const key = normalizeMuscle(m.muscle)
        volumeByMuscle.set(key, (volumeByMuscle.get(key) ?? 0) + (ex.volume ?? 0))
      }
    }
    for (const [muscle, volumeKg] of volumeByMuscle) {
      const bouts = muscleBouts.get(muscle) ?? []
      bouts.push({ trainedMs, volumeKg })
      muscleBouts.set(muscle, bouts)
    }
  }

  const now = opts?.now ?? Date.now()
  return Array.from(muscleBouts.entries()).map(([muscle, bouts]) => {
    const latest = bouts.reduce((a, b) => (b.trainedMs > a.trainedMs ? b : a))
    const sortedVolumes = bouts.map(b => b.volumeKg).sort((a, b) => a - b)
    const typical = sortedVolumes[Math.floor(sortedVolumes.length / 2)]
    const ratio = typical > 0 ? latest.volumeKg / typical : 1
    const tau = Math.min(48, Math.max(16, 24 * ratio))

    const hoursAgo = Math.min(168, (now - latest.trainedMs) / 3_600_000)
    const pct = Math.min(100, Math.round(100 * (1 - Math.exp(-hoursAgo / tau))))
    return { muscle, pct, hoursAgo: Math.round(hoursAgo) }
  })
}
