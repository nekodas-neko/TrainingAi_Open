# 2026-08-10 — API responses stop asking to be cached, and a standing rule is reversed (Q-166)

**Branch:** `chore/api-cache-headers-no-store` · **Domain:** `platform` · no version bump
(no user-visible behaviour change — the client already bypassed this layer)

Q-166 came to the owner as a decision because it **contradicts a standing CLAUDE.md rule**. They
chose option 2: state that this app manages its own cache with explicit invalidation, so API
responses are `private, no-store`, and amend the rule that asks for SWR headers at creation.

## What the rule said, and why it is now the opposite

Since session 177: *"New aggregate GET routes ship SWR headers at creation:
`Cache-Control: private, max-age=60, stale-while-revalidate=120`."* It sounds like free
performance. What it actually does is put a **second cache underneath the app's own**, and it is
the only one `invalidateCache()` cannot reach.

That is not a theoretical objection. An unsafe method only invalidates its *own* url, so
`POST /api/phase-sets` → `GET /api/phase-sets` self-heals, while
`DELETE /api/supplements/<id>` → `GET /api/supplements` kept returning the deleted row for a
minute — **on a route that already shipped the header, in production**. The client-side fix
(`cachedFetch` and the service worker both sending `cache: 'no-store'`) landed 2026-08-09 and
closed the bug. It also made the header nearly inert: with the service worker bypassing every
`/api/` request, `Cache-Control` on these routes governs almost nothing on the canonical runtime.

So the header buys ~nothing and has cost correctness once. Both halves now point the same way.

## Re-measured before touching anything

The entry's premise was checked against reality first, because the last eight backlog items in this
run had premises that did not survive reading the code:

| claim | measured |
|---|---|
| the SWR header actually reaches the client | yes — `curl -D` on prod shows it verbatim |
| a headerless route handler is implicitly no-store | **no** — Next.js emits *no* `Cache-Control` at all, in dev *and* in production (`/api/status`, `/api/version` compared side by side) |

That second one changes the shape of the work. Without a header, freshness is left to the browser's
**heuristic** caching rather than being decided — which is why the ~13 headerless data routes are
worth an explicit `private, no-store` too, not just the ones being converted.

## What changed

- **76 route files, 85 header sites** → `private, no-store`. Three distinct values were in use
  (`max-age=60/30/10` with matching SWR windows); all collapse to one.
- **13 data routes that had no header at all** now send it explicitly: `coach/threads`,
  `day-checkin`, `friends`, `oura/hr-window`, `oura/workouts`, `phase-sets`, `profile/[userId]`,
  `progression-styles`, `scale-ble/today`, `scale-ble/pending`, `session-explain/insight`,
  `user/bedtime-estimate`, `workout-templates`. (The entry listed 12; `scale-ble/pending` is the
  one it missed.)
- **`lib/ai/stream.ts`** carries it for both AI streaming routes at once, rather than per-route. A
  cached *stream* would be the worst case of the lot — a mid-stream error marker frozen in.
- **`scripts/check-api-no-store.js`** (Custom Rules) fails on `max-age`, `s-maxage`,
  `stale-while-revalidate`, `stale-if-error` or `immutable` in any `app/api` route. Mutation-tested
  by putting the old header back on `weekly-stats`: it fails, naming file and line.
- **`CLAUDE.md`** — the SWR rule is replaced, and the bypass rule below it now says what retired it.

**One exemption, with its reason in the script:** `/api/version`. It is public, session-independent,
and its 5 minutes of staleness are the point — they keep the update card off the GitHub API on every
app open. Left alone likewise: `app/exercise-media/[...key]` (immutable assets, outside `app/api`)
and `app/sw.js` (`no-cache`, deliberate).

## Both halves stay, and they fail independently

The client bypass is now redundant *in the sense that* nothing asks to be cached. It stays anyway,
and the comments at both sites say why rather than leaving a future reader to delete "dead"
defence: a route that regains a header is invisible to the route tests, and a new fetch helper
without the bypass is invisible to the header check. Two independent guarantees, one test each.

## Verified

- Measured on the running dev server, signed in as the seeded user — **21 routes**, both halves:
  every one returns **200 with `private, no-store`**. `/api/version` still returns
  `public, max-age=300`; `/api/status` still headerless (deliberately untouched).
- Write round-trip on the exact route the original measurement used: `POST /api/phase-sets` →
  the new row appears in the list; `DELETE` → it is gone, immediately.
- Pages load clean: `/`, `/health`, `/nutrition`, `/workout-select`, `/more` all 200, no errors in
  the dev log. (`/calendar` 404s — there is no such route; not a regression.)
- `tsc --noEmit` clean · **435 files / 3458 tests** green · all 18 custom-rule scripts pass ·
  eslint clean on the touched files (16 warnings, all pre-existing unused imports).

## Not exercised

- **The APK.** The change is a response header, so there is no device-specific code path — but the
  claim that removing it costs nothing on device rests on the service worker already bypassing, and
  *that* was itself never device-verified (see the v1.276.3 Known-Issues row). If the SW branch does
  not behave as measured in the browser, this change is what covers it — which is an argument for
  it, not against, but it is not the same as having watched it.
- **The uncontrolled first-load window.** Option 3 in the entry — counting how many `/api/` reads
  happen on a cold APK start before the service worker takes control — was not measured. Those
  reads now go to the network every time instead of possibly hitting a 60s HTTP cache. On a
  single-user app against Railway that is judged negligible, but it is judged, not measured.
