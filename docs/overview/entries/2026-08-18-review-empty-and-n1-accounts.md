# 2026-08-18 — Review: the empty account, the n=1 account, and a probe that could not have worked

**Agent:** Review 📖 · **Branch:** `claude/review-empty-and-partial-data` · **Docs-only.**
**Filed:** nothing · **Review:** [`docs/reviews/2026-08-18-empty-and-single-datapoint-accounts.md`](../../reviews/2026-08-18-empty-and-single-datapoint-accounts.md)

## What was done

All **126** static GET routes driven twice: once as an account with zero rows in every domain, once
after giving it exactly one `body_metrics` row and one `sleep_sessions` row. Aggregate routes are
where divide-by-zero and mean-of-empty live, and nothing had driven them at those sizes.

## The method correction is the deliverable

The probe grepped each response body for `NaN` and `Infinity`. Both runs came back clean and I was
about to record it. **The check cannot detect either value:**

```
JSON.stringify({x: NaN})  →  {"x":null}      (and the same for ±Infinity)
```

Both serialise to `null`, indistinguishable from a legitimate no-data null. A numeric-corruption
check must never be run against a serialised JSON body — audit the divisions, or use a differential
(numeric at n=many, `null` at n=1 while its input exists), never a string match on the response.

## What the correct method found

Auditing every mean-style division across `app/api`, `packages/shared/src` and `lib/health`: **no
unguarded division.** The four that looked unguarded from a grep each carry an explicit early return
immediately above — `health-trends:111`, `cardio-week:24`, `oura/hr-window:61`,
`admin/program-export:51` — and the rest are ternary-guarded at the expression.

**No route changed behaviour between zero data and one data point.** Status distribution was
identical across both runs.

## The three 5xx, all environmental and not filed

`/api/download-apk` 502 (GitHub unreachable from the sandbox), `/api/push/subscribe` 503 (VAPID
unset), and `/api/oura-ble/decoder-constants` 500 with an empty body (the vendored constants are
deliberately absent from the public repo).

The last was deliberately not filed. It has no `try`/`catch`, so the throw reaches the client
bodiless — but the client already handles it correctly: `isUsable()` in
`steps-decoder-constants-client.ts` exists precisely to reject an error-shaped payload, and
`runStepsMotionDecoder` throws on an absent table rather than producing plausible wrong numbers.

`onRequestError` was verified working: it caught that 500 and wrote an `error_events` row with the
exact message, checked by querying the table after the run. The hook does what its comment claims for
the ~80 route files with no `catch`.

## Not verified

Local `pnpm dev`. Not on the APK, not against production, and only the 126 **static** GET routes —
dynamic-segment routes need a valid id each and would be a different exercise.
