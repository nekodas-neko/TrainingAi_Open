import { withCheckinRoute } from '@/lib/weekly-checkin/route'
import { DismissBodySchema } from '@/lib/weekly-checkin/schemas'
import { dismissCheckin } from '@/lib/weekly-checkin/engine'

/** #3890: "Later" — the card goes away for the week; it can still be saved after. */
export async function POST(req: Request) {
  return withCheckinRoute(req, 'dismiss', DismissBodySchema, (ctx, body) => dismissCheckin(ctx, body.weekStart))
}
