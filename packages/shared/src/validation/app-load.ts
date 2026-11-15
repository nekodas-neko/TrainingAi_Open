// `/api/app-load` bodies: one row of `app_load_metrics` (BF-19). The web shell posts its navigation
// timing; the native app posts its start-up marks (#3774) under `/native/<platform>/<mark>` routes.
import { z } from 'zod'

// Bounds reject the impossible, not the slow: a 10-minute load is a corrupt reading, and a route
// longer than 200 chars is not a route.
export const AppLoadSchema = z.object({
  route:           z.string().min(1).max(200),
  responseStartMs: z.number().int().min(0).max(600_000).nullable().optional(),
  domContentMs:    z.number().int().min(0).max(600_000).nullable().optional(),
  totalMs:         z.number().int().min(0).max(600_000),
  cold:            z.boolean(),
  buildId:         z.string().max(64).nullable().optional(),
}).strict()
