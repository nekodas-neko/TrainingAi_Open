import type { ComponentType, CSSProperties } from 'react'
import {
  Swords, Shield, Rocket, Dumbbell, Crown, Trophy, Zap, Diamond,
  Sunrise, Moon, CheckCircle2, Bed, CalendarCheck, Activity, Star,
} from 'lucide-react'
import type { AchievementResult } from '@/components/profile/achievements-grid'

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

export const TITLES: Record<string, TitleDef> = {
  iron_will:     { display: 'Iron Will',      Icon: Swords,        unlockedBy: 'streak_60'       },
  unbroken:      { display: 'Unbroken',        Icon: Shield,        unlockedBy: 'streak_30'       },
  powerhouse:    { display: 'Powerhouse',      Icon: Rocket,        unlockedBy: 'volume_100k'     },
  iron_beast:    { display: 'Iron Beast',      Icon: Dumbbell,      unlockedBy: 'volume_50k'      },
  the_veteran:   { display: 'The Veteran',     Icon: Crown,         unlockedBy: 'sessions_250'    },
  century_club:  { display: 'Century Club',    Icon: Trophy,        unlockedBy: 'sessions_100'    },
  set_machine:   { display: 'Set Machine',     Icon: Zap,           unlockedBy: 'sets_5000'       },
  pr_machine:    { display: 'PR Machine',      Icon: Diamond,       unlockedBy: 'prs_25'          },
  dawn_warrior:  { display: 'Dawn Warrior',    Icon: Sunrise,       unlockedBy: 'early_bird_5'    },
  ghost:         { display: 'Ghost',           Icon: Moon,          unlockedBy: 'night_owl'       },
  macro_master:  { display: 'Macro Master',    Icon: CheckCircle2,  unlockedBy: 'calorie_goal_30' },
  well_rested:   { display: 'Well Rested',     Icon: Bed,           unlockedBy: 'sleep_streak_30' },
  relentless:    { display: 'Relentless',      Icon: CalendarCheck, unlockedBy: 'months_12'       },
  road_runner:   { display: 'Road Runner',     Icon: Activity,      unlockedBy: 'steps_30k'       },
  ultramarathon: { display: 'Ultramarathon',   Icon: Activity,      unlockedBy: 'steps_50k'       },
  built_different: { display: 'Built Different', Icon: Star,        unlockedBy: 'months_6'        },
}
