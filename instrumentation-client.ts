import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/observability/sentry-scrub'

// Browser/WebView runtime. Next 15's client instrumentation hook.
//
// **`NEXT_PUBLIC_` is unavoidable here and is not a leak** — a Sentry DSN is a write-only ingest
// key by design, and it ships inside every client bundle of every Sentry install. It is not a
// secret in the sense the auth token is.
//
// **The CSP note from the original decision is live, not stale.** The APK is a WebView loading the
// Railway URL, so a `connect-src` that does not include the ingest host silently drops every client
// event — the exact failure mode this item exists to avoid. Verify on the device, not just in a
// browser.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
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
  // No replay integration is added, deliberately — see the server config.
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
