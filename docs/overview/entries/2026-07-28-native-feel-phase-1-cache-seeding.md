## 2026-07-28 — Native-feel Phase 1: seed the seven remaining unseeded read surfaces

Implements Phase 1 of [`docs/superpowers/plans/2026-07-28-native-feel-roadmap.md`](../../superpowers/plans/2026-07-28-native-feel-roadmap.md)
(backlog Q-1), from issue #868. Research and the three retractions landed separately in #876.

### Context — the root cause was infrastructure, not code

The app service was moved to Singapore on 2026-07-28 while the **Postgres service stayed in
us-east**, so every query crossed the Pacific: strictly worse than either single-region setup, and
silent. The owner moved Postgres to Singapore the same day. Anything measured or felt during that
window describes the split configuration, not the application.

That matters for sequencing: the roadmap deliberately gates Phases 2–4 behind a device
re-measurement, because the configuration that produced the original complaint no longer exists.
This PR ships only the part that is correct regardless of what that measurement says.

### Change

Seven components called `cachedFetch`/`cachedFetchToday` with **no synchronous cache seed**, so they
painted a spinner or nothing on every visit until the network answered — the "a skeleton flash on a
repeat visit is a bug" rule in `CLAUDE.md`. Each now reads its own cache key synchronously inside the
existing fetch `useEffect` (never a `useState` lazy initializer — that caused the session-165
hydration mismatches) before the fetch revalidates:

| File | Key seeded |
|---|---|
| `components/home-day-timeline.tsx` | `home-day-timeline` (the only one visible on load) |
| `app/session-select/components/week-day-sheet.tsx` | `day-log:<date>` |
| `components/workout/exercise-stats-sheet.tsx` | `exercise-history:<name>` |
| `components/workout/exercise-hr-trend-card.tsx` | `exercise-hr-trend:<name>` |
| `components/workout/log-activity-sheet.tsx` | `activity-types` |
| `components/profile/macro-targets-pane.tsx` | `nutrition-targets` |
| `components/nutrition/assign-step.tsx` | `nutrition-meal-types`, `nutrition-targets` |

`readTodayCacheSync` pairs with `cachedFetchToday` and `readCacheSync` with `cachedFetch` — the
variants are never mixed for one key. `macro-targets-pane` grew a `targetsToForm` helper so the seed
and the fetch share one mapping instead of duplicating it.

`components/shell/bottom-nav.tsx` was left unseeded on purpose: it fetches `admin-pending-count`, a
badge, not content.

### Correction to the prior session's numbers

An earlier count in this investigation reported "29 of 72 components unseeded". That was wrong — the
grep matched only `readCacheSync` and missed `readTodayCacheSync`, a different function used widely.
The real figure was **11 of 72**, and only one of those was visible on load. Coverage was already
85%, not 60%. The corrected figure is what this PR acts on.

### Tests

`pnpm tsc --noEmit` clean; `pnpm lint` 0 errors (114 pre-existing warnings untouched).

Seeding was **observed working**, not inferred: a Playwright run against `pnpm dev` wrote a
known-good entry into `ta_cache:home-day-timeline` in the app's own envelope format, **aborted every
`/api/day-timeline` request**, and confirmed the timeline still painted. Before this change the same
conditions rendered nothing. The seed user has no timeline events today, so a plain reload test
would have proved nothing — hence the controlled-cache approach.

### Not verified

- **On-device (S25 APK).** Pure client cache reads, no layout or native surface touched, so the
  safe-area/WebView risk is nil — but no device run was performed.
- **Real Brisbane→Singapore latency**, and therefore how much of the remaining slowness this
  removes. That is Phase 0 of the roadmap and needs the owner's device.
- **Production per-endpoint server compute** — attempted in-sandbox and abandoned (`pnpm start`
  forces `NODE_ENV=production`, which switches the pool to SSL the local Postgres socket can't
  serve). Still unmeasured.
