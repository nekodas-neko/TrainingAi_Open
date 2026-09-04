import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/observability/sentry-scrub'

// Server runtime. See lib/observability/sentry-scrub.ts for what never leaves.
//
// **This does NOT replace `error_events`.** That path (instrumentation.ts → recordRequestError)
// stays exactly as it is and remains the record of record: it is queryable, it is in our own
// database, and it captures things Sentry is not configured to. What Sentry adds is the one thing
// `error_events` structurally cannot do — **notify**. It is pull-only, it prunes at 30 days, and
// the first read of it found three faults of which two had already stopped before anyone looked.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // `sendDefaultPii: false` is the SDK-level switch; `beforeSend` is the app-level one. Both, because
  // the first is a default that a future SDK version could change and the second is ours (Q-404).
  sendDefaultPii: false,
  beforeSend: scrubEvent,
  // No session replay and no profiling: both capture far more of a health screen than an alerting
  // tool needs, and the reason this vendor was accepted at all was alerting.
  tracesSampleRate: 0,
  // Off in dev, so a local stack trace does not become a third-party record. The DSN being unset
  // locally already achieves this; the flag makes it deliberate rather than incidental.
  enabled: process.env.NODE_ENV === 'production',
})

// BF-92. This failure was invisible for 13 days because an unset DSN and a quiet week look
// identical from outside — nobody can tell "nothing broke" from "nothing could be reported". One
// line at boot removes that ambiguity permanently, and it names BOTH DSNs because the server
// process can read the client's `NEXT_PUBLIC_` one too, so a single server-side log covers the
// path that has no log of its own.
//
// The DSN itself is never printed: it is write-only by design, but a URL in a deploy log gets
// copied into places a deploy log's audience is not.
if (process.env.NODE_ENV === 'production') {
  console.info(
    `[sentry] server DSN ${process.env.SENTRY_DSN ? 'found' : 'MISSING'}; ` +
    `browser DSN ${process.env.NEXT_PUBLIC_SENTRY_DSN ? 'found' : 'MISSING'}; ` +
    `browser events tunnel via /monitoring (same-origin, so no connect-src entry is needed)`,
  )
}
