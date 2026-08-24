# A guard that survived deleting the thing it guarded (LB-7)

**Branch:** `fix/recipe-spec-structural-attribution` · **Lane B** · `e2e/` + one `data-testid`

## What was wrong

`e2e/recipe-url-to-meal.spec.ts` checked that a scraped recipe shows its attribution with:

```ts
await expect(dialog.getByText('example.com').last()).toBeVisible({ timeout: 20_000 })
```

`.last()` hit the attribution *because the attribution renders after the name* — a position, not an
identity. `MyMealsPicker` creates the row with `name: hostOf(url)` the moment Enter is pressed and
keeps that name until the scrape resolves, so during the `looking` window **the host is on screen
twice**: once as the name, once in the attribution. Delete the attribution and `.last()` lands on
the name.

## It was measured, not reasoned

The entry asserted the hole; asserting it is not the same as having it. Two runs, against the same
component mutated to `{false && m.sourceUrl && (…)}`:

1. **With the mock fulfilling immediately, the old assertion FAILED.** The scrape resolved before
   the locator did, so the real name had already replaced the host and the only remaining
   `example.com` was the deleted attribution. On this evidence alone the guard looks fine.
2. **With `await new Promise(r => setTimeout(r, 8000))` before `route.fulfill`, it PASSED** — with
   no attribution anywhere on screen. The `looking` window was wide enough for the locator to match
   the name.

So the guard is not reliably hollow; it is hollow **whenever the scrape is slow** — the condition CI
is most likely to produce and a local run least likely to, which is the worst shape a test defect
can have. The first run's red is not the answer.

## The fix

`data-testid="meal-source-attribution"` on the attribution row, and the spec asserts on that row:

```ts
const attribution = dialog.getByTestId('meal-source-attribution')
await expect(attribution).toBeVisible({ timeout: 20_000 })
await expect(attribution).toContainText('example.com')
```

The later `from a 12-serve recipe` check moved onto the same locator too — that suffix renders
*inside* the attribution row, so pinning it to the row that owns it costs nothing and stops it
drifting into a bare dialog-wide text match.

Mutation-checked both ways: the new assertion fails on the mutated component (fast mock **and**
slow), and passes on the real one.

## Verification

`npx playwright test e2e/recipe-url-to-meal.spec.ts` — 4 passed. `pnpm check:rules` — Ran 55 of 55.

## Not exercised

Nothing user-visible changed — the only production edit is a `data-testid` attribute. There is no
device behaviour here to check on the S25.

No `projectOverview.md` note: test hardening with no Known Issue attached, in a file on a
shrink-only ratchet that every session reads before it can start.
