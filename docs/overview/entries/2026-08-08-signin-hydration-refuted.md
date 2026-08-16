# 2026-08-08 — The sign-in React #418 does not exist (Q-151, refuted)

**Branch:** `fix/signin-hydration-mismatch` · **Domain:** `app-shell` · docs-only, no code change

## What was claimed

Q-151, from the running-app review: `/sign-in` carries a second, still-live React #418 hydration
mismatch; React #418 is the highest-count production error (153 in 30 days); Q-73 fixed only the home
instance, so the login screen keeps generating them.

Went looking for the reproduction, which the entry rightly called the hard part. Found three
measurements that point the other way.

## 1. Production has never recorded a #418 on the sign-in page

```
SELECT count(*) FILTER (WHERE url LIKE '%sign-in%'), count(*) FROM claude_ro.error_events
WHERE message LIKE '%React error #418%'
  ->  0  /  272
```

Every one of the 272 is on an authenticated route: `/` (234), `/more` (15), `/health` (13), four
`/workout` URLs (7). The count the entry attributes to `/sign-in` belongs somewhere else entirely.

## 2. The series stopped at Q-73's deploy

Last #418 anywhere in production: **2026-08-07 20:53:02 UTC**. Q-73's fix (#1130) merged
**2026-08-08 07:12 +1000**, which is **2026-08-07 21:12 UTC** — nineteen minutes later. Nothing
since.

Daily counts for the fortnight before, so the zero can be judged against a baseline rather than
assumed meaningful:

| day (UTC) | 07-26 | 07-27 | 07-28 | 07-29 | 07-30 | 07-31 | 08-01 | 08-02 | 08-03 | 08-04 | 08-05 | 08-06 | 08-07 | 08-08 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| #418 | 4 | 9 | 13 | 5 | 6 | 7 | 2 | 2 | 12 | 4 | 1 | 1 | 3 | **0** |

## 3. It does not reproduce

`/sign-in` loaded signed out in a scripted Chromium at 412×915, against **both** a dev server and a
**production `next build` + `next start`**, under four localStorage states: none, `theme=light`,
`theme=dark` + `ta_brand_hue=280`, and `ta_brand_theme=violet`. Those are not arbitrary — they are
the states that make the inline theme script in `app/layout.tsx` mutate `<html>`'s class, dataset and
inline styles *before* React hydrates, which is the mechanism the entry suspects.

**Zero console messages of any kind, in all eight runs.**

The page's three plausible culprits were read and cleared as well:

- `Meteors` — renders an empty array on the server and fills it in from `useEffect`. No SSR output to
  mismatch.
- `Typewriter` — `useState("")`, so server and first client render agree.
- `GoogleSignIn` — all `Capacitor`/`crypto`/`localStorage` access is inside the click handler.

## What I am not claiming

- **One clean day is one day.** A ~4/day baseline dropping to zero, on the day a causally-related fix
  deployed, nineteen minutes after the last occurrence, is a good signal — but CLAUDE.md's rule
  applies: *something that stopped is not something that was fixed*. Hence a dated re-check rather
  than a deletion.
- **The signed-in home path was not reproduced locally.** `NODE_ENV === 'production'` hard-forces
  `ssl: true` in `lib/data/postgres/client.ts:16` and the local Postgres refuses SSL, so login fails
  against `next start` (`CallbackRouteError: The server does not support SSL connections`). A local
  production build can therefore only exercise signed-out routes. Home-after-Q-73 rests on telemetry.
- **The reviewer may well have seen something.** What is measured is that it is not attributable to
  `/sign-in`, not reproducible in eight runs across two build modes, and not visible in 30 days of
  production telemetry for that route.

## What changed

`docs/implementation-backlog.md` — Q-151 rewritten from a 🟠 fix into a ⏳ watch item that says on its
first line to skip it when working the queue. The only thing left is the re-check about a week out:
if #418 returns, `error_events.url` names the route and a fresh entry gets filed against *that*
route; if it is still zero, the entry gets deleted.

`projectOverview.md` — the running-app review's Known-Issues row corrected, since it currently
asserts the class is open on the strength of this entry.
