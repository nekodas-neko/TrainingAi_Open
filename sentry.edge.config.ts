import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/observability/sentry-scrub'

// Edge runtime (middleware). Same scrubbing as the server config — the runtime differs, the data
// sensitivity does not.
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
