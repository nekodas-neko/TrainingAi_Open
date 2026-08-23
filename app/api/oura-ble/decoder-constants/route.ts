import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { rateLimit } from '@/lib/rate-limit'
import { getStepsDecoderConstants } from '@/lib/oura-models/constants'

// The `steps_motion_decoder_2_0_0` dequantisation table, for the client-side decode that activity
// auto-detection and the cadence tracker run on ring step frames.
//
// It is served here rather than bundled (Q-221). As a static JSON import it was compiled into the
// browser bundle, and `middleware.ts`'s matcher excludes `_next/static` — so those chunks were
// fetchable with no session at all. The owner's rule is that nothing derived from Oura's IP is
// reachable unauthenticated, and this was the only thing failing it.
//
// It does NOT make the numbers secret from a signed-in user: anyone with a session can read this
// response, and a value the client computes with has to reach the client somehow. What it closes is
// *publication* — a public bundle and a public repo. Removing them from the device entirely would
// mean decoding server-side, which would make auto-detection require the network on an offline-first
// app; that trade is documented in the plan and was not taken.
export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`oura-ble-decoder-constants:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // Read through the same accessor the server pipeline uses, so there is still exactly one source
  // for the table and the two paths cannot drift.
  //
  // Caught, because the accessor reads disk and `JSON.parse(readFileSync(...))` threw straight out
  // of here (Q-455): the caller got a **500 with an empty body**, so a client doing `res.json()`
  // stacked a parse exception on top of the original fault and learned nothing from either. The
  // boot-time constants check makes an unreadable directory a deploy failure rather than a
  // first-request one, but the first-request path still exists — and it is the path a device on a
  // freshly-deployed instance takes.
  //
  // Deliberately not a fallback: there is no degraded dequantisation table, and a client that
  // silently decoded step frames with the wrong numbers would be worse than one that could not
  // decode them at all. This turns a shapeless failure into a legible one, nothing more.
  try {
    return NextResponse.json(getStepsDecoderConstants(), {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (err) {
    console.error('[decoder-constants] failed to read the steps decoder table:', err)
    return NextResponse.json(
      { error: 'Decoder constants unavailable' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }
}
