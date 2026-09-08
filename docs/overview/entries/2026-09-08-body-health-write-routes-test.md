# 2026-09-08 — the four body/health writes get their first tests (PS-39)

**Branch:** `test/body-health-write-routes` · **Lane A** · PS-39, coverage ratchet **96 → 92**.

## What shipped

`lib/__tests__/body-health-write-routes.test.ts` — 30 cases covering `POST/GET /api/injuries`,
`GET/POST/DELETE /api/fitness-tests`, `GET/POST /api/measured-rmr` and
`GET/POST/DELETE /api/blood-panel`. No product change; the routes were already right.

Batched because these are the four places a **clinical or measured** number enters the app, and each
one feeds something that moves training or nutrition. What they share is that their bounds are
plausibility rather than validation theatre — an RMR outside 500–5000 kcal is a typo or a unit
mix-up, and storing it silently moves the calorie target.

The decisions the response shapes hide, now pinned:

- **`blood-panel` accepts no patient identifiers.** `.strict()` is the de-identification guarantee, so
  a body carrying a name or a date of birth is a 400 rather than a column nobody noticed. The analyte
  key is derived from the label server-side; `flagText` is stored as the provider's own words rather
  than parsed into a verdict.
- **Two labels normalising to one key are refused by name**, not left to fail as a driver error on
  `(panel_id, analyte_key)`.
- **A delete that matched nothing answers 404**, identically to a panel that never existed, so an id
  from another account cannot be probed.
- **Cross-field plausibility catches what per-field bounds cannot** — 100,000 m in 1 s passes both of
  its own bounds, and its VO2max estimate then feeds every training zone.
- **Every date is accepted with either separator and stored with dashes**, because the client's
  `localDateString()` emits slashes and the columns are `date`.

## Mutation pass — 37 mutations, 3 survivors, 2 of them real

The two real ones were both cases where a test passed for the wrong reason:

1. **The caller's-timezone default proved nothing for twenty hours of the day.** The case pinned
   `Etc/GMT-14` and asserted the stored date matched it — but that zone agrees with `DEFAULT_TZ` most
   of the day, so replacing `todayInTz(tz)` with `todayInTz(DEFAULT_TZ)` survived. The zone is now
   picked at run time from the fixed-offset list, choosing one whose day *currently* differs. That is
   the `local-day-fixture-anchoring.test.ts` shape, and it is the second time this class has come up
   in these files — a fixture derived from the clock is not enough if the two sides come from
   different zones.
2. **The 201-analyte case was testing the collision check, not the size bound.** All 201 were copies
   of one label, so the duplicate-key rejection fired first and `.max(200)` could be deleted with no
   test noticing. The labels are distinct now, and a 200-analyte panel is asserted to be accepted, so
   the bound itself is what the 400 comes from.

The third survivor is a genuinely **equivalent mutant** and is recorded as one in the file rather
than chased: `avgHr`'s own `.max(250)` is fully shadowed by the cross-field rule, which rejects the
same 20–250 band. Deleting it changes no response for any input.

## Not exercised

Web/Node only. No device run: these are server routes with no native, safe-area, gesture or
notification surface, and the tests mock the repository, so no Postgres path, no drifted production
data and no Samsung WebView rendering were exercised.
