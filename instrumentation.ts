// Next.js server-boot hook. See ./instrumentation-node for the actual work.
//
// The `NEXT_RUNTIME === 'nodejs'` guard is a build-time constant, so webpack dead-code-eliminates
// the dynamic import from the edge/browser bundles — keeping the Node-only DB client (pg, native
// addons) out of every non-node target. This is the documented Next pattern for Node-only
// instrumentation; an early-return guard does NOT let webpack prune the import (it tried to bundle
// pg → fs/path/stream for the edge runtime and the build failed).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Every error that escapes a route handler, App Router page, or server action lands here — Next's
// documented global error hook. It is the only way to see failures from the 80 route files that
// have no `catch` at all: today those reach the client as a bare 500 and leave no trace, which is
// exactly the position that made the /api/body-battery and /api/readiness-score 500s
// undiagnosable.
//
// It does NOT replace `reportServerError`: a route that catches its own error and returns a 500
// itself never reaches this hook. Those routes still need their own call.
//
// Same NEXT_RUNTIME guard and dynamic import as `register()` above, for the same reason — the DB
// client must not be pulled into the edge bundle.
// `headers` is part of Next's own `InstrumentationOnRequestError` signature
// (`next/dist/server/instrumentation/types.d.ts`) and is what makes user attribution possible at
// all — Q-145 was filed as "not implementable" on the basis that Next hands this hook only
// `{ path, method }`, which was this narrowed local type being read as if it were Next's.
export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string; headers?: NodeJS.Dict<string | string[]> },
): Promise<void> {
  // Positive-block guard, NOT an early return — see `register()` above. An early return leaves the
  // dynamic import reachable, webpack keeps it in the edge bundle, and the build fails on `fs`
  // from the pg client. Verified the hard way: written as an early return first, and dev logged
  // exactly that "Can't resolve 'fs'" trace through this file.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { recordRequestError } = await import('@/lib/observability/request-error')
    const cookie = request?.headers?.cookie
    await recordRequestError(err, {
      path: request?.path,
      method: request?.method,
      cookieHeader: Array.isArray(cookie) ? cookie.join('; ') : cookie,
    })
  }

  // And to Sentry, for the alert (Q-404). Deliberately IN ADDITION to `error_events` above, never
  // instead of it: that table is the queryable record in our own database, and this is the thing it
  // structurally cannot do — tell somebody. Sentry's own capture is scrubbed in
  // `lib/observability/sentry-scrub.ts`; it is a no-op when no DSN is configured, which is the case
  // in dev and in every test.
  const Sentry = await import('@sentry/nextjs')
  Sentry.captureRequestError(err, request as Parameters<typeof Sentry.captureRequestError>[1], {
    routerKind: 'App Router', routePath: request?.path ?? '', routeType: 'route',
  })
}
