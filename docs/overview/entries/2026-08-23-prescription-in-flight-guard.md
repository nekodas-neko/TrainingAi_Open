# 2026-08-23 — A rate limit is not an idempotency mechanism (Q-470)

**Branch:** `fix/prescription-regen-in-flight-guard` · **Lane A**

The AI-usage screen reported **14 redundant prescription calls across 8 distinct** — the same logical
prescription generated twice inside 120 s, on the path that decides prescribed load. Unlike Q-471's
top row, this one was real.

## Why it fired twice

`regeneratePrescriptionInBackground` is fire-and-forget and called from **two** sites in the same
`GET /api/workout-data` handler — once when the re-evaluation says `needsRegenerate`, once when
`aiPrescriptionPending && !isPoll`. Then:

- the route is fetched with `cachedFetch`, which paints from cache and **then always revalidates**,
  so every open of the workout screen issues a real GET;
- until the first background generation lands, both conditions are still true, so the next GET
  starts a second generation for the same session-day.

It carried `rateLimit('prescribe:<userId>', 20, 60 * 60 * 1000)`, which caps a runaway loop and was
never an idempotency mechanism — **it is a counter over a window, so it cannot tell "already
running" from "ran a minute ago".** Q-535's redecode job makes the same point about its own 4/min
limit. The limit stays; it does the job it was written for.

## The guard

`packages/shared/src/ai-periodization/regenerate-in-background.ts` holds one marker per
`(userId, programSessionId, today)` — the same key the call's own fingerprint uses — taken before
the work starts and released when it settles.

Two details that are the difference between a guard and a new bug:

- **It releases on rejection, not just on resolve.** A Gemini 502 that left the marker behind would
  wedge that session-day until the process restarted. Pinned by its own test.
- **The guard is checked BEFORE the rate limit**, so a deduped call does not spend budget. Two screen
  opens used to burn two of the twenty.

**The marker is process-local on purpose.** The DB-backed alternative (Q-535 uses a partial unique
index) survives replicas — and needs a staleness reaper for exactly that reason: a process that dies
mid-run holds the slot forever. A `Set` dies with its process, so it self-heals by construction. The
window it leaves open needs two replicas serving one user seconds apart, and the rate limit still
caps the blast radius. Move it to a row if replicas are ever confirmed to run; the key is already
the right one.

## Verification

Eight tests, and **both mutations bite**: deleting the in-flight check fails three of them
(including the rate-limit-budget one), and dropping the `.finally` release fails a different two
(the lease-not-cooldown case and the rejection case). Full suite **545 files / 4,496 tests** green,
`pnpm check:rules` → **51 of 51**, typecheck and lint 0 errors.

**Not exercised: the route branch itself.** Three GETs of `/api/workout-data` under `pnpm dev`
returned 200 with no server errors, but logged no prescription calls — the seeded user has no
AI-dynamic program with a consumed prescription slot, so neither regeneration condition is reachable
on seed data. The guard's logic is covered exhaustively by the unit tests; the route change is a
five-line call into it. Contriving periodization state to force the branch was judged more likely to
produce a false green than a real one.
