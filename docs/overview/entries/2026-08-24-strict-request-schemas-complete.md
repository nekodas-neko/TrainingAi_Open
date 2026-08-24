# The strict-request-schema sweep is finished: 89 → 37, all remainder exempt (Q-464)

**Branch:** `fix/strict-request-schemas-batch6` · **Lane A**

## What shipped

Three more conversions, and — more usefully — the finding that ends the sweep.

- `coach/apply` and `coach/threads`, each read against its real clients first: `number-dial.tsx`,
  `change-preview.tsx` and `confirm-content.tsx` all post `{patch, acceptedChangeIds}`;
  `coach-content.tsx` posts `{threadId, messages:[{role, parts}]}`. Both match exactly.
- `coach/options`, the route-builds-the-object class — it reads two named `searchParams` into a
  literal, so an unknown query key cannot reach the schema. Strict guards nothing there today; it
  costs nothing and catches the day someone swaps the literal for a spread.

## The sweep is complete, and that is the point of this entry

**All 37 remaining non-strict schemas are in a documented exemption class or are not request
schemas at all.** Categorised and verified rather than assumed, now recorded in
`scripts/check-strict-request-schemas.js`'s header:

| class | n | why it must stay permissive |
|---|---:|---|
| outbox / `pushMutations` | 16 | the 8 shared `validation/*` files + `sync/push`. Tightening one dead-letters a mutation queued by an older APK bundle. |
| external / native client | 8 | `oura-ble/*` (5), `scale-ble/samples`, `hr-ingest` (Kotlin `PolarStrapService`/`ScaleBleService`), `health-connect-ingest` (Tasker). The APK does not update with a Railway deploy. |
| third-party SDK wire format | 1 | `coach`, driven by `@ai-sdk/react`'s `DefaultChatTransport`. |
| `generateObject` response schemas | 12 | builder-chat 2, exercises/generate 1, generate-program 2, meal-plans/generate 2, meal-plans/generate/meal 2, nutrition/scan 2, nutrition-goals/recommend 1 — these constrain the model's output, not a client's input. |

So the count is a **floor, not a debt**. The backlog entry is removed; the ratchet stays in the
Custom Rules job permanently, because keeping a *new* non-strict request schema out is what Q-464
was actually for — and prose alone did not hold that line.

## What the whole sweep cost and bought

89 → 37 across six batches, every conversion read against its real client's payload. The tempting
shortcut — "in-repo JS clients ship with the server, so a key mismatch is a bug either way" — is
true and still insufficient: it argues a mismatch *is* a bug, not that there is none. Four traps
prove it, each of which `.strict()` would have turned into a silent 400 on a real request:

- `push/subscribe`'s real body is a browser `PushSubscriptionJSON`, which always carries
  `expirationTime` beside `endpoint`/`keys`.
- `workout-review/apply`'s client sends a `confidence` the route never reads.
- `builder-review.tsx` mints a `clientId` on every exercise in its live program state and posts it
  wholesale to `builder-chat`.

Each was fixed by adding the field to the schema, never by exempting the route.

## Verification

- `pnpm check:rules` — Ran 55 of 55.
- Full suite: 4693 passed, 51 skipped, 2 pre-existing unrelated failures (missing `qrcode` package
  in this sandbox).
- `tsc --noEmit` clean.
- Coach suites green (11 tests).

## Not exercised

**`pnpm dev` could not be run** — this sandbox's `node_modules` is missing `@sentry/nextjs` despite
`package.json` declaring it, a pre-existing gap unrelated to this change. No route was hit with a
live HTTP request this session; static per-client verification stood in for it, as in batch 5. The
exemption categorisation above was verified by reading each file (which schema feeds
`generateObject`, which validation module the adapter imports), not by exercising the paths.
