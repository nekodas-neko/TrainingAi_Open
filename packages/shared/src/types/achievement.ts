/**
 * One achievement as the server computes it (`lib/achievements.ts`) and the profile screens show
 * it. Lived in `components/profile/achievements-grid.tsx` until #3729: the server and this package
 * took the type from a client component, which tied them to the web screens being retired.
 */
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
