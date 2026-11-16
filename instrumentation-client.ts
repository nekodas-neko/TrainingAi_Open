import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/observability/sentry-scrub'
import { sentryRelease } from '@/lib/observability/sentry-release'
import { isSigningOut, SIGN_OUT_ABORT_MESSAGE } from '@/lib/sign-out-fence'

// Browser/WebView runtime. Next 15's client instrumentation hook.
//
// **`NEXT_PUBLIC_` is unavoidable here and is not a leak** — a Sentry DSN is a write-only ingest
// key by design, and it ships inside every client bundle of every Sentry install. It is not a
// secret in the sense the auth token is.
//
// **That CSP hazard was real and it happened — BF-92.** The note used to end "verify on the device";
// nobody did, and for 13 days `connect-src` had no ingest host while this SDK reported nothing and
// the same-origin homegrown reporter logged 9 client faults from the same device. The fix is NOT a
// second host in the header: `next.config.ts` sets `tunnelRoute: '/monitoring'`, so events POST
// same-origin — which `connect-src 'self'` already permits and no future CSP edit can revoke.
// `middleware.ts` deliberately keeps that path behind the auth gate (BF-92), so a report reaches
// Sentry only when it carries the session cookie; see `transportOptions` below.
// `lib/security/__tests__/sentry-tunnel-reachability.test.ts` holds every half, because a comment
// predicting a hazard is what failed here.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // `sendDefaultPii: false` is the SDK-level switch; `beforeSend` is the app-level one. Both, because
  // the first is a default that a future SDK version could change and the second is ours (Q-404).
  sendDefaultPii: false,
  // Which deploy produced the fault: `trainingai@<package version>+<build sha>`. Absent in `pnpm dev`.
  release: sentryRelease(process.env.NEXT_PUBLIC_APP_VERSION, process.env.NEXT_PUBLIC_BUILD_ID),
  // #3806. Sentry sends with its own native fetch, which the sign-out fence cannot see, to a tunnel
  // behind the auth gate whose response re-issues the session cookie. Nothing is sent while a
  // sign-out runs, and the fence's own refusals are not faults.
  beforeSend: (event, hint) => (isSigningOut() ? null : scrubEvent(event, hint)),
  ignoreErrors: [SIGN_OUT_ABORT_MESSAGE],
  // RV-194. The SDK-level cap, paired with `scrubEvent`'s own truncation the same way
  // `sendDefaultPii: false` is paired with `beforeSend` — one is a default a future SDK version
  // could change, the other is ours. Sentry's default is 250; this is deliberately HIGHER, because
  // the useful part of a Drizzle error is the parameterised SQL above the params line and 250 cuts
  // it mid-query.
  maxValueLength: 1000,
  // Since @sentry/nextjs 10.77.1 the tunnel transport sends `credentials: 'omit'` by default. The
  // tunnel sits behind the auth gate, so a cookieless report 307s to /sign-in and is lost; this
  // keeps the session cookie on it, which is how it behaved before (and fetch's own default).
  transportOptions: { fetchOptions: { credentials: 'same-origin' } },
  // No session replay and no profiling: both capture far more of a health screen than an alerting
  // tool needs, and the reason this vendor was accepted at all was alerting.
  tracesSampleRate: 0,
  // Off in dev, so a local stack trace does not become a third-party record. The DSN being unset
  // locally already achieves this; the flag makes it deliberate rather than incidental.
  enabled: process.env.NODE_ENV === 'production',
  // No replay integration is added, deliberately — see the server config.
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
