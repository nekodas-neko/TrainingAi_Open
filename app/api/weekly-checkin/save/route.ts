import { withCheckinRoute } from '@/lib/weekly-checkin/route'
import { SaveBodySchema } from '@/lib/weekly-checkin/schemas'
import { saveCheckin } from '@/lib/weekly-checkin/engine'

/** #3890: save the week's answers (again, to redo). Light, pain and swap only become offers. */
export async function POST(req: Request) {
  return withCheckinRoute(req, 'save', SaveBodySchema, (ctx, body) => saveCheckin(ctx, body))
}
