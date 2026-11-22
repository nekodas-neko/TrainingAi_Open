import { withCheckinRoute } from '@/lib/weekly-checkin/route'
import { OfferBodySchema } from '@/lib/weekly-checkin/schemas'
import { resolveOffer } from '@/lib/weekly-checkin/engine'

/** #3890: accept or decline one offer (a step up, logging an injury, a swap). Nothing changes without this. */
export async function POST(req: Request) {
  return withCheckinRoute(req, 'offer', OfferBodySchema, (ctx, body) => resolveOffer(ctx, body.checkinId, body.offer, body.decision))
}
