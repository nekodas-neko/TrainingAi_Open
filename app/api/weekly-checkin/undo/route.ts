import { withCheckinRoute } from '@/lib/weekly-checkin/route'
import { UndoBodySchema } from '@/lib/weekly-checkin/schemas'
import { undoCheckinEffect } from '@/lib/weekly-checkin/engine'

/** #3890: undo one automatic effect or accepted offer of a saved check-in. */
export async function POST(req: Request) {
  return withCheckinRoute(req, 'undo', UndoBodySchema, (ctx, body) => undoCheckinEffect(ctx, body.checkinId, body.target))
}
