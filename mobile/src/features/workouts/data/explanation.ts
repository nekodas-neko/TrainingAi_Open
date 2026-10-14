import { z } from 'zod';
import {
  buildSessionExplainData,
  type SessionExplainData,
} from '@trainingai/shared/session-explain/build-explain-data';
import type { NextSessionRecommendation } from '@trainingai/shared/types/program';
const number = z.number().finite();
const score = z.object({ score: number, weight: number });
const session = z.object({ id: z.string(), name: z.string() }).passthrough();
const recommendation = z
  .object({
    reason: z.string(),
    session: session.nullish(),
    weightedComponents: z
      .object({ recovery: score, balance: score, freshness: score })
      .optional(),
    scoredSessions: z
      .array(
        z.object({
          session,
          overallScore: number,
          recoveryScore: number,
          balanceScore: number,
          freshnessScore: number,
        }),
      )
      .optional(),
    signals: z
      .object({
        muscleRecovery: z.array(
          z.object({ muscle: z.string(), pct: number, hoursAgo: number }),
        ),
        ouraReadiness: number.nullable(),
        sleepTrend: number.nullable(),
        hrvTrend: number.nullable(),
        energyLevel: z.string().nullable(),
        soreMuscles: z.array(z.string()),
        suggestedSoreMuscles: z.array(z.string()).nullish(),
      })
      .optional(),
    consecutiveTrainingDays: number.optional(),
    deloadOrRestRecommended: z.boolean().optional(),
    deloadStrength: z.enum(['soft', 'recommended', 'strong']).optional(),
    hrvWarning: z.boolean().optional(),
  })
  .passthrough();
export const explanationSpec = (date: string) => ({
  path: '/api/next-session',
  partition: date,
  ttl: 300_000,
  schema: recommendation,
});
export function explanationData(
  value: z.infer<typeof recommendation> | null,
  sessionId: string,
) {
  return buildSessionExplainData(value as unknown as NextSessionRecommendation, sessionId);
}
export const insightSpec = (
  date: string,
  sessionId: string,
  data?: SessionExplainData | null,
) => ({
  path: '/api/session-explain/insight',
  query: { sessionId },
  partition: JSON.stringify([
    date,
    data?.weightedComponents,
    data?.signals.ouraReadiness,
    data?.signals.sleepTrend,
    data?.signals.hrvTrend,
    data?.signals.energyLevel,
    data?.signals.soreMuscles,
    data?.consecutiveTrainingDays,
    data?.deloadOrRestRecommended,
    data?.deloadStrength,
  ]),
  ttl: 3_600_000,
  schema: z.string(),
});
