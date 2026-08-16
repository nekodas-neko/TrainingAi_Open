## 2026-07-29 — Health fetches only the sub-tab it is showing (Phase 4), and Phase 3's framing corrected

Implements [`docs/superpowers/plans/2026-07-28-native-feel-phase-4-request-collapse.md`](../../superpowers/plans/2026-07-28-native-feel-phase-4-request-collapse.md)
(backlog Q-1, Phase 4) from issue #868, and corrects a wrong "do not build" note on Phase 3.

### Phase 4 — the change

`app/health/health-content.tsx` kept a `tab` state of `body | training | progress` and **no fetch
effect read it**. One `fetchAllHealthData` callback fired 13 requests on every mount, then the screen
rendered one of three tabs. The owner's device capture put Health at 53–85 requests, the heaviest
screen in the app by 2–3×.

The fetches are now split into four groups by which tab consumes the state. The mapping was
**derived, not guessed** — counted from what `renderBodySection` / `renderTrainingSection` /
`renderProgressSection` actually reference in `app/health/health-sections.tsx`:

| Group | Endpoints |
|---|---|
| Shared (≥2 tabs, always fetched) | `health/trends`, `progress-summary`, `muscle-recovery`, `activity-types`, plus `fetchMeta` |
| Body | `training-load`, `sleep-performance-correlation`, `injuries` (+ local-store injury hydration) |
| Training | `weekly-stats`, `weekly-muscle-sets`, `workout-data?tab=meta` |
| Progress | `strength-trend`, `user/goals` |

`activity-types` is read by no section renderer but is consumed by the log sheets this screen opens,
so it stays unconditional rather than being tied to a tab.

**No "already loaded" bookkeeping was needed.** `cachedFetch` dedups in flight and honours its TTL, so
re-firing a group when a tab is revisited is a cache hit rather than a request. That also preserves
the `tabEpoch` refresh semantics — returning to Health still revalidates, just one tab's worth.

### Measured

A/B in Chromium against `pnpm dev`, same harness, **all client caches cleared immediately before the
Health load** — without that the home screen has already populated shared keys and the two runs are
not comparable (the first attempt at this measurement was invalid for exactly that reason):

| health-content.tsx | Requests on Health load |
|---|---|
| `main` | **51** |
| this change | **42** |

Switching to Body then fires its group (7 requests observed) rather than nothing, confirming the
lazy path populates rather than leaving cards empty.

### The ceiling is lower than the raw count suggested — worth knowing

Most of the remaining 42 are **not** this screen's doing. `components/sync-provider.tsx` carries a
warm list of ~22 endpoints prefetched on app start regardless of screen — including `training-load`,
`user-goals`, `weekly-stats`, `progress-summary`, `muscle-recovery` and `workout-data:meta`. That
prefetch is *deliberate*: it is what lets screens paint instantly from cache, which is the whole
cache-seeding architecture. **Removing it would trade request count for the instant-paint behaviour
the native-feel work exists to protect.** Anyone chasing the request count further should start there
and should expect that trade to be a bad one.

### Phase 3's framing corrected

An earlier revision of the backlog and roadmap said **"Phase 3 should not be built."** That is
retracted in three places (backlog Q-1, the roadmap's Phase 0 results, and the Phase 3 plan's own
header). It judged bundling the shell purely as a latency optimisation — reasonable after Phase 0
showed the blank second was a blocking Oura Cloud call rather than the remote shell.

**The owner's stated direction is app-native: everything on device, with Postgres demoted to sync and
redundancy.** Bundling the shell *is* that direction, so it is architecture rather than a perf trade
to decline on a millisecond count. What Phase 0 legitimately changes is expectations: it buys cold
start and hard reloads only, and cold start is now dominated by JS parse/execute rather than the
document fetch — so bundling removes the network hop for that JS but not the time spent running it.

### Not verified

- **On device.** The 51→42 figure is from `pnpm dev` in Chromium, not the S25. The device number will
  differ; the direction should not.
- **That every card on every tab still populates on a real account.** The seeded dev user has sparse
  data, so an empty card there is not conclusive either way. A mis-mapped fetch would show as one
  empty card on one tab — worth a glance at all three tabs after deploy.
