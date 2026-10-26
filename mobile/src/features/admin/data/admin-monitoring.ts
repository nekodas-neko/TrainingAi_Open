import { z } from 'zod';

/** Error text, emails and URLs are other people's: none of these reads is kept on the phone's disk. */
const noDiskCache = () => false;

const errorEventSchema = z
  .object({
    id: z.string(),
    source: z.string(),
    message: z.string(),
    stack: z.string().nullish(),
    url: z.string().nullish(),
    userAgent: z.string().nullish(),
    createdAt: z.string(),
    userEmail: z.string().nullish(),
  })
  .passthrough();
export type AdminErrorEvent = z.infer<typeof errorEventSchema>;
export const adminErrorsSpec = {
  path: '/api/admin/errors',
  ttl: 30_000,
  cache: noDiskCache,
  schema: z.array(errorEventSchema),
};

const aiUsageSchema = z
  .object({
    totalCalls: z.number(),
    totalTokens: z.number(),
    totalErrors: z.number(),
    windowSeconds: z.number(),
    sections: z.array(
      z
        .object({
          section: z.string(),
          calls: z.number(),
          errors: z.number(),
          inputTokens: z.number(),
          outputTokens: z.number(),
          totalTokens: z.number(),
          avgLatencyMs: z.number(),
        })
        .passthrough(),
    ),
    doubleTrips: z.array(
      z
        .object({ section: z.string(), redundantCalls: z.number(), affectedFingerprints: z.number() })
        .passthrough(),
    ),
    timeline: z.array(
      z.object({ bucket: z.string(), calls: z.number(), totalTokens: z.number() }).passthrough(),
    ),
  })
  .passthrough();
export type AiUsageSummary = z.infer<typeof aiUsageSchema>;
export const AI_USAGE_WINDOWS = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
] as const;
export const adminAiUsageSpec = (sinceHours: number) => ({
  path: '/api/admin/ai-usage',
  query: { sinceHours: String(sinceHours) },
  ttl: 60_000,
  cache: noDiskCache,
  schema: aiUsageSchema,
});

// Gemini 3.1 Flash Lite approximate token pricing (USD per 1M tokens), as the current app has it.
// An estimate so the admin can eyeball relative spend per section; it is not billed.
const COST_PER_1M_INPUT = 0.1;
const COST_PER_1M_OUTPUT = 0.4;
export function estCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * COST_PER_1M_INPUT + (outputTokens / 1_000_000) * COST_PER_1M_OUTPUT
  );
}
export const fmtUsd = (v: number) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
export const fmtInt = (v: number) => v.toLocaleString('en-AU');
/** Bar heights as a share of the busiest bucket, never under 4% so a quiet bucket still shows. */
export function barShares(calls: readonly number[]): number[] {
  const max = Math.max(0, ...calls);
  return calls.map((c) => (max ? Math.max(4, (c / max) * 100) : 0));
}

const appLoadSchema = z
  .object({
    days: z.number(),
    coldSamples: z.number(),
    warmSamples: z.number(),
    routes: z.array(
      z
        .object({
          route: z.string(),
          cold: z.boolean(),
          samples: z.number(),
          p50Ms: z.number(),
          p95Ms: z.number(),
          worstMs: z.number(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type AppLoadReport = z.infer<typeof appLoadSchema>;
export const APP_LOAD_DAYS = [1, 7, 14] as const;
export const adminAppLoadSpec = (days: number) => ({
  path: '/api/admin/app-load-report',
  query: { days: String(days) },
  ttl: 60_000,
  cache: noDiskCache,
  schema: appLoadSchema,
});
/** Cold and warm are separate reports, never pooled: a percentile over both measures release cadence. */
export function splitLoadRoutes(routes: AppLoadReport['routes']) {
  return {
    cold: routes.filter((r) => r.cold),
    warm: routes.filter((r) => !r.cold),
  };
}
