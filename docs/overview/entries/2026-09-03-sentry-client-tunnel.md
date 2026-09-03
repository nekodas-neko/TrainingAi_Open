# 2026-09-03 — Sentry hears the browser again (BF-92, Lane A)

**Branch:** `fix/sentry-client-tunnel`

## What was wrong

Sentry was connected, correctly configured, scrubbed, and receiving **nothing from the browser** —
for 13 days. `connect-src` in `lib/security/csp.ts` never named the ingest host, so every client
event was refused before it left the page. The natural experiment was already in the app's own data:
over the same window the homegrown reporter, which POSTs **same-origin** to `/api/client-error`,
recorded 9 client faults from the same device, while Sentry held zero browser events. Same app, same
errors, different origin, opposite outcome.

`instrumentation-client.ts` had predicted this failure in its own comment — *"a `connect-src` that
does not include the ingest host silently drops every client event"* — and the host was never added.
**A comment describing a hazard is not a guard against it**, which is the durable lesson and the
reason this change ships with a test rather than a better comment.

## What shipped

- **`next.config.ts`** — wrapped in `withSentryConfig` with `tunnelRoute: '/monitoring'`. The browser
  POSTs same-origin, which `connect-src 'self'` already permits, and Next rewrites it on to
  `*.ingest.sentry.io`. **No CSP edit**, deliberately: the header's comments show it has been
  reasoned about host by host, and tunnelling cannot be silently broken by the next edit to it.
  A fixed path rather than `true` (a random path per build) because the path has to be *named* in
  the middleware matcher and the service worker, and a name that changes every deploy cannot be.
- **`middleware.ts`** — `/monitoring` excluded from the matcher. It was inside it and in no
  `PUBLIC_PATHS`, so an unauthenticated report would have been 307'd to `/sign-in`: the identical
  silent drop, relocated from the CSP to the auth gate.
- **`public/sw-template.js`** — the tunnel path handed to the browser untouched. The catch-all branch
  `cache.put()`s any ok response and the Cache API **rejects a POST Request**, so every successful
  error report would have raised an unhandled rejection inside the service worker.
- **`sentry.server.config.ts`** — one line at boot naming whether **each** DSN was found. The server
  process can read the `NEXT_PUBLIC_` one too, so a single server log covers the path that has no log
  of its own. The DSN value itself is never printed.
- **`lib/security/__tests__/sentry-tunnel-reachability.test.ts`** — six assertions over all three
  gates, plus one that no Sentry host reappears in `connect-src` (which would mean somebody had
  reverted to the shape that broke). Both behavioural assertions were mutation-checked: reverting
  the matcher or the worker branch fails the file.

## The finding that was not in the entry

BF-92 named one gate. There were **three**, in series, each invisible from the layer above:
the CSP, the auth matcher, and the service worker. Only the first had been found by reading; the
other two turned up by following the request end to end through the built artefacts and then through
a running server. That is the argument for tracing a path rather than fixing the layer that was
reported.

## Verification

- `pnpm build`: the tunnel rewrite lands in `routes-manifest.json` (**`afterFiles`** — the first read
  of this said it had not landed, because it looked in `beforeFiles`, which is empty), in both region
  and non-region variants; `_sentryRewritesTunnelPath="/monitoring"` is baked into the client chunks;
  the built `middleware-manifest.json` regex carries the exclusion.
- `pnpm dev`, runtime: `POST /monitoring?o=1&p=2` reached **Sentry's own nginx** — HTTP 401 with
  `x-sentry-error` among the exposed headers — proving the rewrite proxies rather than 404s locally.
  Controls in the same run: a gated page 307s to `/sign-in`, `/sign-in` returns 200.
- Full suite 6410 passed / 86 skipped, Custom Rules **67 of 67**, lint clean, typecheck clean.

## Not verified, and it is the whole gate

**That an event actually arrives in the dashboard.** That needs the APK, signed in, with a deliberate
throw, and it is BF-92's `Gate: device`, unchanged. Nothing here was exercised in the Samsung WebView:
not the service-worker branch (the SW does not run in the sandbox at all), not the safe-area or
rendering paths, and not a real DSN — `enabled` is false outside production, so no SDK call was made
end to end in any of the above.

## Owner decision left open

Excluding `/monitoring` from the auth gate is a genuine **widening**: the path is reachable without a
session. It buys the errors most worth having — the sign-in path has no session by definition, and
`/api/client-error` requires auth, so it has never captured one of them — and it costs a relay that
could forward an envelope to some other Sentry project via this domain. No data of ours, no auth
surface, no database, and the destination host pattern is fixed by the SDK. One line to revert.

## No version bump

Nothing here is user-visible; it changes what the operator can see, not what the app does.
