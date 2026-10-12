import { z } from 'zod';
export const userSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable(),
  name: z.string().nullable(),
  avatar: z.string().nullable(),
  friendCode: z.string().nullable(),
  equippedTitle: z.string().nullable(),
});
export const friendshipSchema = z.object({
  id: z.uuid(),
  requesterId: z.string(),
  addresseeId: z.string(),
  status: z.enum(['pending', 'accepted']),
  createdAt: z.string(),
  updatedAt: z.string(),
  otherUser: userSchema,
});
export type Friendship = z.infer<typeof friendshipSchema>;
export const friendsSpec = {
  path: '/api/friends',
  ttl: 300000,
  schema: z.object({ friendships: z.array(friendshipSchema) }),
};
export const feedSpec = {
  path: '/api/friends/feed',
  ttl: 60000,
  schema: z.object({
    events: z.array(
      z.object({
        type: z.enum(['pr', 'level_up', 'achievement', 'season_badge']),
        userId: z.string(),
        displayName: z.string(),
        avatar: z.string().nullable(),
        equippedTitle: z.string().nullable(),
        occurredAt: z.string(),
        payload: z
          .object({
            exerciseName: z.string().optional(),
            weightKg: z.number().optional(),
            achievementName: z.string().optional(),
            level: z.number().optional(),
            xpReward: z.number().optional(),
            seasonLabel: z.string().optional(),
            badgeLabel: z.string().optional(),
          })
          .passthrough(),
      }),
    ),
  }),
};
const count = z.number().finite().nonnegative();
export const leaderboardSpec = {
  path: '/api/friends/leaderboard',
  ttl: 60000,
  schema: z.object({
    entries: z.array(
      z.object({
        userId: z.string(),
        displayName: z.string(),
        avatar: z.string().nullable(),
        equippedTitle: z.string().nullable(),
        isSelf: z.boolean(),
        weeklySessions: count,
        weeklyVolumeKg: z.number().finite(),
        weeklyStreak: count,
        allTimeSessions: count,
        allTimeVolumeKg: z.number().finite(),
        allTimeStreak: count,
      }),
    ),
  }),
};
export type LeaderboardEntry = z.infer<typeof leaderboardSpec.schema>['entries'][number];
export type Period = 'weekly' | 'alltime';
export type Metric = 'sessions' | 'volume' | 'streak';
export function rankValue(entry: LeaderboardEntry, period: Period, metric: Metric) {
  if (metric === 'volume') {
    return period === 'weekly' ? entry.weeklyVolumeKg : entry.allTimeVolumeKg;
  }
  if (metric === 'streak') {
    return period === 'weekly' ? entry.weeklyStreak : entry.allTimeStreak;
  }
  return period === 'weekly' ? entry.weeklySessions : entry.allTimeSessions;
}
export function rankLabel(value: number, period: Period, metric: Metric) {
  return metric === 'volume'
    ? `${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k kg`
    : metric === 'streak'
      ? `${value} ${period === 'weekly' ? 'weeks' : 'days'}`
      : String(value);
}
export function pendingRequests(rows: Friendship[]) {
  const valid = rows.filter(
    (row) => row.status === 'pending' && row.requesterId !== row.addresseeId,
  );
  return {
    incoming: valid.filter((row) => row.otherUser.id !== row.addresseeId),
    outgoing: valid.filter((row) => row.otherUser.id === row.addresseeId),
  };
}
export function friendName(row: Friendship) {
  return row.otherUser.displayName ?? row.otherUser.name ?? 'Friend';
}
export const achievementSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  category: z.string(),
  xpReward: count,
  unlocked: z.boolean(),
  progress: z.number(),
  goal: count,
  current: z.number(),
});
export const friendProfileSpec = (id: string) => ({
  path: `/api/profile/${z.uuid().parse(id)}`,
  ttl: 60000,
  cache: () => false,
  schema: z.object({
    id: z.string(),
    displayName: z.string().nullable(),
    name: z.string().nullable(),
    avatar: z.string().nullable(),
    friendCode: z.string().nullable(),
    equippedTitle: z.string().nullable(),
    level: count,
    levelLabel: z.string(),
    xp: count,
    currentLevelXp: count,
    nextLevelXp: count,
    lifetimeSessions: count,
    lifetimeVolumeKg: count,
    bestStreak: count,
    totalDistanceKm: count,
    trophyCase: z.array(z.string()),
    unlockedAchievementIds: z.array(z.string()),
    achievements: z.array(achievementSchema),
  }),
});
export type PublicProfile = z.infer<ReturnType<typeof friendProfileSpec>['schema']>;
export const titleLabels: Record<string, string> = {
  iron_will: 'Iron Will',
  unbroken: 'Unbroken',
  powerhouse: 'Powerhouse',
  iron_beast: 'Iron Beast',
  the_veteran: 'The Veteran',
  century_club: 'Century Club',
  set_machine: 'Set Machine',
  pr_machine: 'PR Machine',
  dawn_warrior: 'Dawn Warrior',
  ghost: 'Ghost',
  macro_master: 'Macro Master',
  well_rested: 'Well Rested',
  relentless: 'Relentless',
  road_runner: 'Road Runner',
  ultramarathon: 'Ultramarathon',
  built_different: 'Built Different',
};
export function titleLabel(key: string | null | undefined) {
  return key ? (titleLabels[key] ?? key.replace(/_/g, ' ')) : null;
}
export function feedText(event: z.infer<typeof feedSpec.schema>['events'][number]) {
  const p = event.payload;
  if (event.type === 'pr') {
    return `Hit a new PR on ${p.exerciseName ?? 'an exercise'}${p.weightKg == null ? '' : ` — ${Math.round(p.weightKg)} kg`}`;
  }
  if (event.type === 'level_up') {
    return `Reached level ${p.level ?? '—'}`;
  }
  if (event.type === 'season_badge') {
    return `${p.badgeLabel ?? 'Season badge'}${p.seasonLabel ? ` · ${p.seasonLabel}` : ''}`;
  }
  return p.achievementName ?? 'Completed a workout';
}
