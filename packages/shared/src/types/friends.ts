import type { ComponentType, CSSProperties } from 'react'
import {
  Swords, Shield, Rocket, Dumbbell, Crown, Trophy, Zap, Diamond,
  Sunrise, Moon, CheckCircle2, Bed, CalendarCheck, Activity, Star,
} from 'lucide-react'
import type { AchievementResult } from '@/components/profile/achievements-grid'
import { TITLE_CATALOGUE } from '../achievement-display'

export type LucideIconType = ComponentType<{ className?: string; style?: CSSProperties }>

export interface Friendship {
  id: string
  requesterId: string
  addresseeId: string
  status: 'pending' | 'accepted'
  createdAt: string
  updatedAt: string
  otherUser: {
    id: string
    displayName: string | null
    name: string | null
    avatar: string | null
    friendCode: string | null
    equippedTitle: string | null
  }
}

export interface FeedEvent {
  type: 'pr' | 'level_up' | 'achievement' | 'season_badge'
  userId: string
  displayName: string
  avatar: string | null
  equippedTitle: string | null
  payload: {
    exerciseName?: string
    weightKg?: number
    achievementId?: string
    achievementName?: string
    xpReward?: number
    level?: number
    seasonLabel?: string
    badgeLabel?: string
  }
  occurredAt: string
}

export interface LeaderboardEntry {
  userId: string
  displayName: string
  avatar: string | null
  equippedTitle: string | null
  isSelf: boolean
  weeklySessions: number
  weeklyVolumeKg: number
  weeklyStreak: number
  allTimeSessions: number
  allTimeVolumeKg: number
  allTimeStreak: number
}

export interface PublicProfile {
  id: string
  displayName: string | null
  name: string | null
  avatar: string | null
  friendCode: string | null
  equippedTitle: string | null
  level: number
  levelLabel: string
  xp: number
  currentLevelXp: number
  nextLevelXp: number
  lifetimeSessions: number
  lifetimeVolumeKg: number
  bestStreak: number
  totalDistanceKm: number
  trophyCase: string[]
  unlockedAchievementIds: string[]
  achievements: AchievementResult[]
}

export interface Season {
  id: string
  label: string
  startDate: string
  endDate: string
  result?: {
    rank: number
    sessions: number
    volumeKg: number
    badgeLabel: 'Gold' | 'Silver' | 'Bronze'
  }
}

export interface TitleDef {
  display: string
  Icon: LucideIconType
  unlockedBy: string
}

const TITLE_ICONS: Record<string, LucideIconType> = {
  iron_will: Swords, unbroken: Shield, powerhouse: Rocket, iron_beast: Dumbbell,
  the_veteran: Crown, century_club: Trophy, set_machine: Zap, pr_machine: Diamond,
  dawn_warrior: Sunrise, ghost: Moon, macro_master: CheckCircle2, well_rested: Bed,
  relentless: CalendarCheck, road_runner: Activity, ultramarathon: Activity, built_different: Star,
}

// Display names and unlock rules are the shared catalogue; the web adds its icons.
export const TITLES: Record<string, TitleDef> = Object.fromEntries(
  Object.entries(TITLE_CATALOGUE).map(([id, def]) => [id, { ...def, Icon: TITLE_ICONS[id] }]),
)
