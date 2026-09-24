# 2026-09-24 — RV-194: the scrubber guarded the request and not the exception

**Lane A** · branch `lane-a/rv194-sentry-scrub-gaps`

## What was leaving

`scrubEvent` scrubbed the request URL, body, cookies and headers, and left untouched the thing that
actually throws. Drizzle's own constructor, read out of the pinned `drizzle-orm/errors.js` rather
than from memory:

```js
super(`Failed query: ${query}\nparams: ${params}`)
```

`params` is an **array**, so the template comma-joins the real bound values straight into
`.message`. Every uncaught database error therefore forwarded row values to sentry.io — and on the
`users` path that is an email address.

Three smaller holes alongside it: **console breadcrumbs** carry whatever the app last logged,
verbatim; **navigation breadcrumbs** carry `from`/`to`, which are this app's own URLs with the dates
and ids in them, while only `data.url` was being scrubbed; and **`extra`** and **`contexts`** were
passed through untouched. No `maxValueLength` was set on any of the three runtimes.

## What shipped

- `scrubExceptionValue` cuts at `\nparams:` and caps the result. **The SQL above that line is kept
  deliberately** — Drizzle parameterises, so the query carries `$1`/`$2` placeholders rather than
  values, and it is the half that makes the error diagnosable. Dropping the whole message is the
  over-correction, and a test pins the SQL as present.
- Console breadcrumbs are dropped as a category. There is no way to know in advance that some
  `console.log` did not print a food row, so the category goes rather than being pattern-matched.
- `from` and `to` join `url` in the existing URL scrubber.
- `extra` is deleted outright; `contexts` is **allowlisted** to the SDK's own runtime keys.
- `maxValueLength: 1000` on all three runtimes, paired with the in-code truncation the same way
  `sendDefaultPii: false` is paired with `beforeSend` — one is a default a future SDK version could
  change, the other is ours.

## Two judgement calls

**Allowlist `contexts`, don't drop it.** `contexts` is SDK-populated — os, runtime, trace — which is
machine information, not the user's, and it is what makes an error diagnosable. But `contexts` is an
open bag: any integration added later can put a state dump in it, and a denylist would not know. The
app calls `setContext` nowhere, so the allowlist costs nothing today and holds if that changes.

**Drop `extra` entirely.** Same audit: nothing in this app writes it, so anything arriving there came
from the SDK or an integration and has no shape worth inspecting.

## The entry's path was stale

It named `lib/sentry-scrub.ts`; the file is `lib/observability/sentry-scrub.ts`. Same trap as
RV-163's `score-audit` path — worth noting only because it is now the second time in two days that a
sweep entry pointed at a directory the code had moved out of.

## Verification

`tsc` clean · `lib/observability` suite **25/25**. Mutation pass: **7 mutants, 6 killed** — removing
the exception scrub, keeping console breadcrumbs, scrubbing `url` but not `from`/`to`, keeping
`extra`, disabling the `contexts` allowlist, removing the truncation — and **1 deliberately
equivalent control** survived correctly, rewriting the `indexOf`/`-1` guard as an
`includes`-then-`indexOf` pair.

**Not exercised:** no event was sent to sentry.io. The scrubber is a pure function tested against a
message built from the pinned Drizzle constructor, not against a live capture, so what is verified
is that the shape Drizzle documents gets scrubbed — not that production throws exactly that shape.
`enabled` is false outside production, so a local capture could not have shown it either.
