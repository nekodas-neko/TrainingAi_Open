# 2026-09-06 — LA-59: the meal-type reorder reads the status it is given

**Branch:** `fix/la-59-reorder-status` · **Lane B** · v1.436.19

`handleDragEnd` in `meal-type-manager.tsx` fired the reorder as:

```ts
fetch(...).then(() => invalidateMealTypes()).catch(() => toast.error('Failed to save order'))
```

**A `fetch` promise does not reject on a 4xx.** So the `.then` ran for every response the server
sent — including a refusal — and the `.catch` only ever saw a transport failure. RV-48 gave this
route a 404 for a reorder it declines to apply; nothing on this surface read it.

## What shipped

`await` + `if (!res.ok) throw`, then **a refetch, not just a toast**. That distinction is the entry's
and it is the substance of the fix: a 404 here means the list the drag was computed from is stale — a
meal type deleted on another device is the realistic route — so re-reading the list is what resolves
it. Restoring the previous *local* order would only put back a different wrong one, and a toast alone
leaves the screen showing an order the server rejected.

`saveEdit` in the same file is the pattern copied: optimistic, `if (!res.ok) throw`, recover on
failure. This was the last of the four surfaces RV-45/RV-47/RV-48 touched; the two admin ones and the
exercise manager already checked. The two Oura `PATCH` callers are deliberately fire-and-forget and
are untouched.

## Verified

**The premise, live against the dev server** — this is what the old code was swallowing:

| request | response |
|---|---|
| reorder with the six real ids, reversed | **200** |
| reorder with one id replaced by a stale UUID | **404** `{"error":"Meal type not found"}` |
| restore the original order | **200** |

**Three source guards**, mutation-tested — removing the `if (!res.ok) throw` fails two of them. They
pin the three properties separately: no bare `.then`/`.catch` on a fetch, an `if (!res.ok)` for every
`await fetch` in the file, and `invalidateMealTypes().then(load)` inside the drag handler's catch.

`tsc` clean · lint clean · `pnpm check:rules` **Ran 68 of 68** · full unit suite green.

## Not exercised — and this is the honest gap

**The toast and the refetch were never watched happening.** What is proven is that the route returns
the 404 and that the code now reads it; what is not proven is the two things the user would see.

**⚠ The cause first written here was wrong.** It said the settings sheet did not render, which reads
as a defect in the manager. It is not one. The ad-hoc scripts waited 8 seconds for a page the dev
server had not finished compiling — the e2e specs use 30–60 s for the same page — and one of them
pointed at port 3000 while the harness, and the session cookie in `e2e/.auth/`, belong to **3100**
(`playwright.config.ts:23`). Given a long enough wait on the right port the page renders in full.
Recording the wrong cause is worse than recording none, because the next session goes looking for a
bug that was never there.

**Closing that properly needs a `@dnd-kit` drag simulated in Playwright** with the PATCH stubbed to
404 — `empty-meal-library.spec.ts` has the route-stubbing shape (`serviceWorkers: 'block'`, a
per-page `page.route` with `route.fallback()` for the methods it does not want), and it taps a
coordinate via `page.touchscreen.tap` inside a `toPass` loop rather than calling `.click()`, which is
the third thing an ad-hoc script gets wrong on this surface. That is more work
than the twelve-line fix and is worth doing; it is not worth blocking the fix on. Recorded as a
Known-Issues row rather than left implied.

**Not verified on device**, for the same reason as every UI change this session.
