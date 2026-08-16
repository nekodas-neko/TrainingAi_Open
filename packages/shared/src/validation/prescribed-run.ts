import { z } from 'zod'

// Shared by the web PATCH route (app/api/running-plan/runs/[id]) and the pushMutations
// 'prescribed_run' branch — one schema so the two write paths cannot drift.
export const PrescribedRunPatchBody = z.object({
  id:            z.string().uuid(),
  status:        z.enum(['completed', 'skipped']),
  activityLogId: z.string().uuid().nullable().optional(),
})
export type PrescribedRunPatch = z.infer<typeof PrescribedRunPatchBody>
