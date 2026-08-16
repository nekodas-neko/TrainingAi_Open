# 2026-08-12 — "Milk" returns milk, quantities take servings again, and the sheet header gets two rows

**Release:** v1.291.0 · **Domain:** nutrition (plus one app-shell fix) · **Branch:** `fix/saved-meals-header-rows`

Four owner reports from the S25, all against v1.290.0 which had shipped an hour earlier. Two of them
are corrections to that release.

## "Milk" was returning cheese

v1.290.0 shipped with a comment claiming `sort_by=unique_scans_n` had dealt with this. **It had not,
and the comment was wrong about the mechanism** — sorting reorders a result set, it cannot change
what is in it. Open Food Facts matches free text against **ingredient lists**, so cream cheese,
cheddar and processed cheese are all genuine hits for "milk". Measured on the device: nine results,
zero of them milk, most of them Moroccan and French products.

Two changes, both needed:

- **Filter to the region.** `tagtype_0=countries&tag_0=australia`. This is the single biggest
  relevance lever and it was simply absent. Search now returns Coles, Woolworths, Chobani, Vitasoy.
  When the region leaves fewer than five hits the world index is added underneath rather than
  showing a near-empty list.
- **Require the query to match the product's own name, as whole words.** Substring matching is not
  enough — `"milk"` is inside `"Milka"`, so a plain `includes` put a chocolate bar top of the list.
  Verified before and after: *Milka Oreo* and *Cadbury Dairy Milk* led the results; now *Vitasoy oat
  milk*, *Coles Full Cream Milk*, *Devondale Full Cream Pure Milk*.

## The database kept saying it was not responding — because we were causing it

Multi-word queries came back `unavailable` almost every time. The dev log settled it: **HTTP 503,
which for this endpoint is rate limiting, not an outage.** OFF asks for roughly ten searches a
minute; the client was firing one per 250 ms debounce, chained behind the food-library fetch, so
typing "chicken breast" spent the budget on prefixes of it.

- The OFF lookup moved into **its own effect at a 700 ms debounce**, off the food-library chain
  entirely — which also fixes the defect filed as Q-198 the same morning (a stalled library fetch
  removed the database section and its spinner).
- Our own rate limit dropped from 40/min to **12/min**, just above OFF's, so we refuse before they
  do and the message is ours.
- A 503 is **retried once after 400 ms**, which is enough for most of them.

Measured after: `greek yogurt` → 20 results led by Chobani; `chicken breast` → 20 led by Coles and
Aldi. Before: both `unavailable`.

## Quantities take servings again

v1.290.0 replaced the `1×`/`2×`/`3×` multiplier with a grams field. That fixed "is this the 30 g
scoop or the 60 g one" and broke "I want two scoops" — the owner's report was exactly that. Each
ingredient now has a **srv / g switch**, defaulting to servings, and shows what one serving weighs.
The stored value is the serving multiplier either way; grams is a second view of one number, not a
second number. ± steps by half a serving or 5 g, matching whichever unit is showing.

`IngredientRow` was extracted to a component to keep `saved-meals-sheet.tsx` under the 800-line
check (815 → 739).

## The sheet header

v1.290.0 stopped the ✕ overlapping the New Meal button by reserving the corner. On-device that just
made the row cramped — three controls fighting for the right-hand side. The title now sits alone on
the first row with the ✕ in its corner, and the actions get their own full-width row below.

## What this says about the previous release

Two of these four are corrections to code that shipped a few hours earlier with green CI, a passing
test suite and headless-browser verification. **Both were things the sandbox could measure and I did
not measure**: I asserted `sort_by` fixed relevance instead of reading the results, and I read one
503 as OFF's flakiness rather than checking what was causing it. The device did not reveal anything
the sandbox could not have — it revealed things that were not looked at.

## Not exercised

- **Not verified on device.** The srv/g switch, the two-row header and the search results are
  measured in headless Chromium at 412×915 only.
- **OFF's rate limit is shared per IP, not per user.** In production every user's searches come from
  the same Railway egress, so the 12/min per-user limit does not bound the upstream rate the way it
  does for one user in a sandbox. Fine for today's user count; noted as a real ceiling.
- No migration, no schema change, no sync-path change.

## Files

| Path | Change |
|---|---|
| `app/api/nutrition/food-search/route.ts` | Region filter, whole-word name match, shortest-name ranking, 503 retry, 12/min |
| `components/nutrition/ingredient-row.tsx` | New — one ingredient with the srv/g unit switch |
| `components/nutrition/saved-meals-sheet.tsx` | Two-row header, OFF search on its own debounce, row extracted |
| `components/nutrition/ingredient-search.tsx` | Serving weight on own-food rows, placeholder copy, clear-✕ label and tap target |
