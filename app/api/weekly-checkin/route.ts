import { withCheckinRoute } from '@/lib/weekly-checkin/route'
import { readCheckinState } from '@/lib/weekly-checkin/engine'

/** #3890: the weekly check-in's state — is a card due, the week's summary, the main lifts, saved answers and offers. */
export async function GET(req: Request) {
  return withCheckinRoute(req, 'state', null, ctx => readCheckinState(ctx))
}
