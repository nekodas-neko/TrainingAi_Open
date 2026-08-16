# 2026-08-13 — barcode scanning says when the food database is down (v1.302.3)

**Branch:** `fix/barcode-reports-off-outage-as-not-found`

## What the owner reported

"Barcode scanning and AI photo meal logging isn't working." Two features, apparently broken together
— which usually means a shared dependency. It turned out to be two unrelated causes, and neither was
a bug in the features themselves.

## What the telemetry actually showed

Both of the owner's requests are in the Railway HTTP logs, minutes apart:

| Request | Status | Upstream duration |
|---|---|---|
| `GET /api/nutrition/barcode` | 404 | **81,443 ms** |
| `POST /api/nutrition/scan` | **200** | **129,073 ms** |

**The photo scan succeeded.** It took 129 seconds, so the client had long given up — but the route
did its job and returned a result. There is nothing wrong with it. It was starved by **Q-213**: CPU
was pegged at 1.07 → 1.60 → 1.13 across 12:40–12:50 Brisbane, exactly spanning both requests. Fixing
Q-213 fixes this; nothing in the nutrition code needs to change.

**Barcode was a genuine Open Food Facts outage.** Probed directly from the sandbox with our exact
`User-Agent`: `502` on the product API *and* on `world.openfoodfacts.org` itself, serving an
"🍊 Unscheduled downtime" page, three probes in a row. Worth noting because it contradicts the
existing heuristic in `docs/domains/nutrition/README.md` — "an OFF 503 is usually our own rate
limiting". That is still true of **503**. This was a **502**, and OFF really was down.

## What shipped

The barcode route turned every OFF failure into `{ notFound: true }`, so the UI rendered
**"No match found — this product isn't in the database."** During an outage that statement is false,
and it is the kind of false that costs the owner work: they believe the product is unknown and type
it in by hand.

`unavailable` and `notFound` are now different answers, rendered differently — an outage says so and
keeps the photo/manual fallbacks, an absence still points at the photo scanner.

**The search route has drawn this distinction since it was written**, with a comment saying exactly
why ("letting the UI render 'nothing found' … would be a lie"). Barcode is the sibling that never got
it — a plain sibling-surface miss. Rather than write a third copy of the fetch-and-classify logic,
`offFetchJson()` now lives in `packages/shared/src/nutrition/open-food-facts.ts` beside `OFF_FIELDS`
and `OFF_USER_AGENT`, and both routes call it. The barcode route also gained the timeout and
try/catch it never had — it previously had no error handling at all, which is why `error_events`
showed nothing for it across 30 days despite the outage.

## Verified

Against the **live** OFF outage on the local dev server, authenticated as the seeded user:

- `GET /api/nutrition/barcode?code=3017624010701` → `{"unavailable":true}` **503** in 1.5 s
  (previously `{"notFound":true}` 404)
- `GET /api/nutrition/barcode?code=abc` → `{"error":"Invalid barcode format"}` 400, unchanged
- `GET /api/nutrition/food-search?q=milk` → `{"results":[],"unavailable":true}`, unchanged across the
  refactor onto the shared helper

Seven unit tests pin `offFetchJson`'s contract: parsed body on success, the shared User-Agent, null
on 502, no retry on a non-503, one retry on 503, give up after two 503s, and a thrown fetch
propagating so the caller can tell it apart from a clean miss.

Full suite green — 459 files, 3,783 tests. `tsc --noEmit` clean, lint clean, all 20 custom-rule
checks pass.

## Not exercised

- **The genuine `notFound` path could not be tested end-to-end**, because OFF is down — there is no
  way to make it answer "no such product" right now. That branch's logic (`data.status !== 1`) is
  unchanged, and the unit tests cover the helper it sits behind, but the live path was not walked.
- **The S25.** The barcode scanner uses the device camera via a Capacitor plugin, which does not run
  in the sandbox — only the route and its response shape were exercised. The changed UI copy has not
  been seen at the S25 viewport.
- Native SQLite, safe-area insets, Samsung WebView rendering — untouched by this change.

## Follow-up

The 129-second photo scan is **Q-213**, not a nutrition bug, and is filed there. `/api/nutrition/scan`
also uses `maxRetries: 0` and reports failures only to stdout (`console.error`), never through
`reportServerError` — which is why 30 days of `error_events` showed nothing for it. Filed as
**Q-218**.
