import { z } from 'zod';
import { achievementSchema } from '../../social/data/models.ts';

/** `GET /api/achievements`: the server's XP, level and unlock state. Preview only reads it. */
export const achievementsSchema = z.object({
  level: z.number(),
  levelLabel: z.string(),
  xp: z.number(),
  currentLevelXp: z.number(),
  nextLevelXp: z.number(),
  lifetimeStats: z.object({
    sessions: z.number(),
    totalVolumeKg: z.number(),
    bestStreak: z.number(),
    totalSets: z.number(),
    totalDistanceKm: z.number(),
  }),
  achievements: z.array(achievementSchema),
});
export type Rewards = z.infer<typeof achievementsSchema>;
export type Achievement = Rewards['achievements'][number];
/** The one definition of this view; More and the workout summary read the same entry. */
export const achievementsSpec = {
  path: '/api/achievements',
  schema: achievementsSchema,
  ttl: 300000,
};

export const seasonSchema = z.object({
  id: z.string(),
  label: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  result: z
    .object({
      rank: z.number(),
      sessions: z.number(),
      volumeKg: z.number(),
      badgeLabel: z.string(),
    })
    .nullish(),
});
export type Season = z.infer<typeof seasonSchema>;
/** `GET /api/seasons`: each season, with this player's result once one is in. */
export const seasonsSpec = {
  path: '/api/seasons',
  schema: z.object({ seasons: z.array(seasonSchema) }),
  ttl: 1_800_000,
};
