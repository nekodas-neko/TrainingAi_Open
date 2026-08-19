# 2026-08-19 — Q-404: the Sentry SDK is wired, and an event was watched arriving

**Branch:** `feat/wire-sentry-sdk` · Implementation Lane A · **⚠ NOT self-merged — see "The decision
this needs" at the end.**

## Why this was open at all

The deferral was recorded, correctly, in
`docs/handoff-2026-08-17-platform-agent-model-and-device-session-findings.md`: *"The Sentry SDK is
not wired… Deferred on purpose so the session that wires it can verify events arrive rather than
assume — a configured DSN and a silently-dropping one look identical."*

Good call, wrong home. **A deferral that lives only in a handoff is an orphaned finding**, so nothing
in the queue was going to pick it up, and what surfaced it was Sentry's own *"no errors are coming
through yet"* email rather than anything in this repo.

## Premise re-verified against current `main`

Confirmed, before writing anything: no `@sentry/nextjs` dependency, no `sentry.*.config.ts`, no
`SENTRY_*` reference in any source file. **And the Sentry project's issue list was empty over 14
days**, which is the same fact from the other end.

## What shipped

- `@sentry/nextjs` ^10.70.0, initialised in all three runtimes — `sentry.server.config.ts`,
  `sentry.edge.config.ts`, `instrumentation-client.ts` — registered from the existing
  `instrumentation.ts` behind the same `NEXT_RUNTIME` guards that keep the pg client out of the edge
  bundle.
- `onRequestError` now reports to Sentry **in addition to** `error_events`, never instead.
- **`lib/observability/sentry-scrub.ts`, shipped in the same PR as the DSN**, because the entry says
  so and because this is a health app.

## What it adds, and what it does not replace

`error_events` is **not** redundant and should not be removed. Server errors are already captured
(`instrumentation.ts` → `recordRequestError`), and client errors too (`components/error-reporter.tsx`,
`app/error.tsx`). Sentry fills the **alerting** gap: `error_events` is pull-only, prunes at 30 days,
and the first read of it found three faults of which two had already stopped before anyone looked.
Nothing notifies. That is the whole reason this is here.

## The scrubbing, and the one thing it nearly missed

`sendDefaultPii: false` **and** an app-level `beforeSend`, because the first is a default a future SDK
version could change and the second is ours. Request bodies are dropped outright — there is no
version of a body in this app that is safe to forward, it is food, weight, sleep or a credential.
Cookies and `Authorization` go. Breadcrumb URLs are scrubbed, which is the quiet leak: every fetch
the app made is in there by default. The user id is kept and everything else about the user is not —
the id is how a fault is attributed and is meaningless without this database.

Paths are scrubbed by **shape rather than by a route allowlist**: an allowlist goes stale the moment
someone adds a route, and this app adds routes constantly, whereas "a uuid in a path is an id" stays
true.

**A test caught a real gap rather than just failing.** The first version handled `YYYY-MM-DD` and not
`YYYY/MM/DD` — and `localDateString()` emits the slash form, so a date reached the scrubber as three
separate segments that each look like a harmless number, and the app's own date format would have
gone through untouched. Now collapsed as a run, with an assertion that a year-like number *not*
followed by two two-digit segments is left alone.

No session replay and no profiling: both capture far more of a health screen than an alerting tool
needs, and alerting is the reason the vendor was accepted.

## Verified — an event was watched arriving

The entry is explicit that this is not done when the SDK is installed but when an error is **observed
in the project**. So:

| | |
|---|---|
| Sentry issues before | **0** (14-day window) |
| Deliberate error posted to the project's ingest endpoint | HTTP **200**, event id returned |
| Sentry issues after | **1** — `Q404WiringProbe: Deliberate error proving the Sentry wiring delivers (q404-…)`, first seen 11:33:10Z |

So the DSN is live, the project accepts events, and nothing silently drops them. **The org/project
and the key were read through the `SENTRY_AUTH_TOKEN` already present in the session env; no DSN or
key is committed anywhere in this diff** — checked.

`pnpm build` clean · `npx tsc --noEmit` clean · `pnpm lint` clean · `pnpm check:rules` **Ran 49 of
49** · full suite **521 files / 4,275 tests passed** · 16 unit tests on the scrubbing.

## Not exercised, and this is the honest boundary

**What was proven is that the project ingests. What was NOT proven is that the app's own SDK wiring
emits** — that needs `SENTRY_DSN` set in a deployed environment, which the sandbox is not. So the
deferring session's concern is half-closed: a silently-dropping *DSN* is ruled out, a
silently-not-initialising *app* is not, and the check after deploy is to throw one server error and
one client error and watch the issue count move again.

**The client half has a live CSP consideration**, flagged in the original decision and still true:
the APK is a WebView loading the Railway URL, so a `connect-src` that omits the ingest host silently
drops every client event — the exact failure this item exists to avoid. **Verify on the device, not
in a browser.**

## The decision this needs — not self-merged

Three things put this outside the standing self-merge authority: it introduces **secret handling**
(two new Railway vars), it opens a **data path to a third party in a health app**, and it **reverses
a prior recorded decision** (*"Decision made against a Sentry-type vendor: single user, data stays in
Railway, no CSP changes"*). The owner has since reversed that, which is why the entry exists — but
the reversal was about alerting, and it is worth being explicit that this sends nothing but errors,
scrubbed.

**To go live it needs, in Railway:** `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`, both the project's
existing public DSN. Until they are set the SDK initialises to a no-op, so **merging is safe and
inert on its own** — which is also the argument for merging before setting them rather than after.

**Update, later the same day — the owner had already set them, and one half is confirmed from
production.** `NEXT_PUBLIC_SENTRY_DSN` is inlined into the deployed client bundle
(`o4511924403044352.ingest.us.sentry.io`), which is direct evidence rather than inference: a
build-time `NEXT_PUBLIC_*` var cannot appear there unless it was set.

`SENTRY_DSN` is **not** confirmed, and cannot be by observation alone. It is server-only so it never
reaches the bundle, and **`tracesSampleRate: 0` means the server SDK transmits nothing until
something throws** — so "zero events received in 24 h" is precisely what a correctly-wired,
error-free deploy looks like. Absence of evidence, and the config makes it so by design.

Project state at the time of writing: **1 issue in 14 days**, the pre-merge `Q404WiringProbe`
(platform `node`, 11:33 UTC — *before* #227 merged at ~12:20), and **1 event received in 24 h**,
that same one. So nothing has yet travelled the deployed server path.

**The only proof is a deliberate server error in production**, which creates a real Sentry issue and
an `error_events` row. Left undone rather than done quietly: it is an outward-facing action on the
owner's live app, and the client half needs the device anyway (the APK is a WebView, and a
`connect-src` omitting the ingest host would drop every client event silently). Both belong in one
deliberate check, not a drive-by.
