# Review — the empty account and the n=1 account, and a probe that could not have worked

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** aggregate routes under zero and single-point data
**Findings filed:** none · **Method correction:** one, and it is the point of this document

## Why this lens

Aggregate routes are where divide-by-zero and mean-of-empty live, and nothing had driven them with
an account holding no data or exactly one data point. I drove all **126** static GET routes twice —
once as an account with zero rows in every domain, once after giving it exactly one `body_metrics`
row and one `sleep_sessions` row.

## The result that matters is that my first method was invalid

The probe grepped each response body for `NaN` and `Infinity`. Both runs came back clean, and I was
about to record "no `NaN` or `Infinity` across 126 routes at n=0 and n=1".

**That check cannot detect either value.**

```
JSON.stringify({x: NaN})       →  {"x":null}
JSON.stringify({x: Infinity})  →  {"x":null}
JSON.stringify({x: -Infinity}) →  {"x":null}
```

Both serialise to `null`, which is indistinguishable from a legitimate "no data" null. A review probe
that greps an HTTP response for `"NaN"` is measuring nothing at all, and the clean result it produces
is worth exactly as much.

**The rule this establishes:** a numeric-corruption check must never be run against a serialised JSON
body. Detect it at the computation — audit the divisions — or by differential (a field numeric at
n=many and `null` at n=1 *while its input exists*), never by string-matching the response.

## What the correct method found

Auditing the divisions directly, across `app/api`, `packages/shared/src` and `lib/health`: every
mean-style division by a `.length` or a count is guarded. The four that looked unguarded from a grep
all carry an explicit early return immediately above:

| Site | Guard |
|---|---|
| `app/api/health-trends/route.ts:111` | `if (pcts.length === 0) return null` |
| `app/api/cardio-week/route.ts:24` | `if (!vals.length) return null` |
| `app/api/oura/hr-window/route.ts:61` | `if (!samples.length) return NextResponse.json({ avgHr: null, … })` |
| `app/api/admin/program-export/route.ts:51` | wrapped in `if (sets.length > 0)` |

The rest are ternary-guarded at the expression (`vals.length > 0 ? … : null`). **No unguarded
division found.**

## What the route sweep did establish

Status distribution was identical at n=0 and n=1 — 76–77 × `200`, 33 × `403` (admin-gated),
11 × `400` (a required query param missing), 2 × `404`, and three 5xx that are unchanged between the
two runs and environmental:

| Route | Status | Cause |
|---|---|---|
| `/api/download-apk` | 502 `{"error":"Could not fetch release info"}` | GitHub not reachable from this sandbox |
| `/api/push/subscribe` | 503 `{"error":"Push not configured"}` | VAPID keys unset locally |
| `/api/oura-ble/decoder-constants` | 500, **empty body** | the vendored constants file is deliberately absent from the public repo |

**No route changed behaviour between zero data and one data point**, which is the useful half of the
sweep: nothing crashes or degrades on the transition from "no history" to "one reading".

## Recorded as observations, deliberately not filed

- **`/api/oura-ble/decoder-constants` returns a bodiless 500** — it has no `try`/`catch`, so a
  throw from `getStepsDecoderConstants()` reaches the client with no body. Not filed, for two
  reasons. The cause here is environmental (the constants are Oura-derived material kept out of the
  public repo on purpose, per `scripts/private-paths.json`), and **the client already handles it
  correctly**: `lib/activity/steps-decoder-constants-client.ts` runs `isUsable()` specifically to
  reject an error-shaped payload — *"a truncated or error-shaped payload must never be injected: the
  decoder would then run on a table missing columns and produce physical values that look real"* —
  and `runStepsMotionDecoder` throws on an absent table rather than guessing. The failure is loud
  where it matters and silent only in the response body.
- **The fault is observable.** `instrumentation.ts`'s `onRequestError` caught it and wrote a row to
  `error_events` with the exact message (`ENOENT … lib/oura-models/consta…`), verified by querying
  the table after the run. The hook does what its comment claims for the ~80 route files that have
  no `catch`.

## Not verified

Local `pnpm dev`. Not on the APK, not against production, and only the **126 static** GET routes —
dynamic-segment routes (`[id]`) were excluded because they need a valid id per route and would have
made the sweep a different exercise.
