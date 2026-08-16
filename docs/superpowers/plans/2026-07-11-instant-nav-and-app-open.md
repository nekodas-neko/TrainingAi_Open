# Instant Tab Navigation & Fast App Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the network round-trip from bottom-nav tab taps and the network-first block from app open, so navigation and startup paint instantly from local state and revalidate silently — the P1/P2/P3 fix packages from `docs/reviews/2026-07-11-offline-feel-performance-review.md`.

**Architecture:** Three independent chunks. **Chunk A (instant nav):** keep tab RSC payloads in the Next client router cache (`experimental.staleTimes`) so warm tab taps are zero-network; add `loading.tsx` boundaries so any cold navigation responds on the tap frame; take the per-navigation Postgres query off `/more`. **Chunk B (More-tab fixes):** stop More's pull-to-sync from wiping the entire cache (`invalidateCache('')` → the domain-flag group invalidation `sync-provider.tsx` already uses) and gate its frozen Oura Cloud call on BLE freshness. **Chunk C (fast open):** serve cached documents stale-while-revalidate from the SW (same-build only), stagger the startup warm-fetch stampede, and add a native splash screen. No schema changes; no data-path semantics change — every task is shell/caching-layer only.

**Tech Stack:** Next.js 15 App Router (`staleTimes`, `loading.tsx`, route groups), service worker (`public/sw-template.js`), Capacitor 8 (`@capacitor/splash-screen`), existing `lib/sqlite/cache.ts` + `lib/cache-groups.ts` layers.

**Verification reality (read first):** the perceived-latency wins are only truly judged on the S25 APK. Everything here except Task 10 is dev-server verifiable; the plan's dev-server checks prove *mechanics* (no `?_rsc=` refetch, no full-cache wipe), and `docs/device-smoke-checklist.md` gains the on-device checks (Task 11). The review's `staleTimes` analysis is inferred from Next 15 docs — **Task 5 verifies it empirically before anything else builds on it.**

**Ordering constraints:**
- Chunks are independently landable, **A → B → C order recommended** (A is the headline win).
- **Task 8 (SW documents) is written against the shipped v1.130.0 offline-shell SW rework**
  (precache manifest, previous-generation retention, `/offline` fallback — landed 2026-07-11,
  session 271). It preserves that rework's offline-fallback chain and `res.ok` guards; if the
  template has drifted again by implementation time, re-verify the final pages handler before
  editing.

---

## Chunk A — Instant tab navigation (P1)

### Task 1: Router-cache retention (`staleTimes`)

**Files:**
- Modify: `next.config.ts:52-54`

- [ ] **Step 1: Add `staleTimes` to the experimental block**

Replace the current `experimental` block:

```ts
  experimental: {
    optimizePackageImports: ['lucide-react', '@phosphor-icons/react', 'motion/react'],
  },
```

with:

```ts
  experimental: {
    optimizePackageImports: ['lucide-react', '@phosphor-icons/react', 'motion/react'],
    // Client router cache: keep visited/prefetched tab payloads for 5 minutes so
    // tab-to-tab navigation reuses them instead of refetching ?_rsc= from the
    // server on every tap (the Next 15 default for dynamic routes is 0 — discard
    // immediately, which made the bottom nav's prefetch={true} useless). Tab
    // pages are thin auth-gating shells; all data renders client-side from the
    // local cache layer, so a minutes-old RSC payload cannot show stale data.
    staleTimes: { dynamic: 300, static: 300 },
  },
```

- [ ] **Step 2: Build to confirm the option is accepted**

Run: `pnpm build 2>&1 | tail -5`
Expected: build completes, exit 0, **no** "Unrecognized key(s) in object: 'staleTimes'" warning in the output. (If Next warns the key is unknown, stop — the installed minor doesn't support it and the fallback is the SW-side RSC handling noted in the review §5-P1.4; do not proceed on a warned-unknown config key.)

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "Keep tab RSC payloads in the client router cache for 5 minutes

Next 15's default staleTimes.dynamic=0 discarded every prefetched/visited
tab payload immediately, so each bottom-nav tap refetched the route from
the server — the ~1s navigation delay on the APK. Tab pages are auth
shells; data renders client-side from the local cache, so reuse is safe."
```

---

### Task 2: Shared `TabLoading` skeleton component

**Files:**
- Create: `components/shell/tab-loading.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { BottomNav } from "@/components/shell/bottom-nav";

// Instant fallback for the tab routes' loading.tsx boundaries. Neutral pulse
// blocks only — per-screen cache-seeded content paints as soon as the client
// component mounts, so this is visible for one network round-trip at most
// (and, with staleTimes retention, usually never).
export function TabLoading() {
  return (
    <>
      <div className="flex flex-col bg-page min-h-screen pt-safe-or-4 px-4 gap-4" aria-busy="true">
        <div className="h-8 w-40 rounded-lg bg-muted/60 animate-pulse" />
        <div className="h-28 rounded-2xl bg-muted/40 animate-pulse" />
        <div className="h-40 rounded-2xl bg-muted/40 animate-pulse" />
        <div className="h-28 rounded-2xl bg-muted/40 animate-pulse" />
      </div>
      <BottomNav />
    </>
  );
}
```

Notes for the implementer:
- `BottomNav` is a client component with an optional `isAdmin` prop — rendering it bare here just means no admin badge during the loading frame, which is correct (a `loading.tsx` has no session).
- `pt-safe-or-4` and `bg-page` are the mandated shared utilities (CLAUDE.md safe-area + background rules) — verify both exist in `app/globals.css` before relying on them (`grep -n "pt-safe-or-4\|bg-page" app/globals.css`).
- This deliberately does NOT violate the "skeleton defeats cache-seed" rule: that rule is about `next/dynamic({ loading: … })` racing a mounted card's own seed. A route `loading.tsx` shows only while the route segment itself hasn't arrived — there is no seeded component on screen yet to defeat.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/shell/tab-loading.tsx
git commit -m "Add shared TabLoading skeleton for tab route loading boundaries"
```

---

### Task 3: `loading.tsx` boundaries for the five tabs (+ home route group)

**Files:**
- Move: `app/page.tsx` → `app/(home)/page.tsx`
- Create: `app/(home)/loading.tsx`
- Create: `app/health/loading.tsx`
- Create: `app/workout/loading.tsx`
- Create: `app/nutrition/loading.tsx`
- Create: `app/more/loading.tsx`

Why the route group: `loading.tsx` next to `app/page.tsx` would sit at the root segment and become the fallback for **every** route without its own boundary (`/sign-in`, `/admin`, `/pending`, `/profile/*`) — flashing a bottom nav on the sign-in flow. `app/(home)/` scopes the boundary to `/` alone; route groups don't change URLs.

- [ ] **Step 1: Move the home page into a route group**

```bash
mkdir -p "app/(home)"
git mv app/page.tsx "app/(home)/page.tsx"
```

`app/page.tsx` uses only `@/`-absolute imports (`@/auth`, `@/app/session-select/session-select-content`, `@/components/shell/bottom-nav`), so no import edits are needed. Confirm: `grep -n "from \"\./" "app/(home)/page.tsx"` → no output.

- [ ] **Step 2: Create the five loading boundaries (identical file content)**

`app/(home)/loading.tsx`, `app/health/loading.tsx`, `app/workout/loading.tsx`, `app/nutrition/loading.tsx`, `app/more/loading.tsx` — each:

```tsx
import { TabLoading } from "@/components/shell/tab-loading";

export default function Loading() {
  return <TabLoading />;
}
```

(Workout note: a `?session=` deep link renders the full-screen `WorkoutScreen` without a bottom nav, so this boundary shows a nav for one frame on that path — cosmetic and rare; the common case is the tab tap, where the nav is correct.)

- [ ] **Step 3: Dev-server check**

Run: `pnpm dev` (background), then `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/` and the same for `/health`, `/workout`, `/nutrition`, `/more`.
Expected: `307` (unauthenticated redirect to `/sign-in`) or `200` for every route — i.e. the route-group move broke nothing. Then sign in as `test@local.dev` / `testpass123` in a browser and confirm `/` renders the home screen at the same URL.

- [ ] **Step 4: Commit**

```bash
git add "app/(home)" app/health/loading.tsx app/workout/loading.tsx app/nutrition/loading.tsx app/more/loading.tsx
git commit -m "Add loading boundaries to the five tab routes

Navigation previously had no loading.tsx anywhere, so a tab tap that hit
the network froze the outgoing screen for the whole RSC round-trip. Home
moves into an (home) route group so its boundary doesn't leak to
/sign-in and /admin."
```

---

### Task 4: Take the Postgres query off `/more`'s render path

**Files:**
- Modify: `app/more/page.tsx`
- Modify: `app/more/more-content.tsx:24-79`

`/more` is the only tab doing a DB round-trip per navigation (`getRepository()` + `getUserByEmail`). The client already has a full profile path (`readCacheSync('more-user-profile')` seed + `cachedFetch('/api/user/profile')`), and that route returns the full user row **including `equippedTitle`** — so the server props are redundant.

- [ ] **Step 1: Rewrite `app/more/page.tsx`**

```tsx
import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import MoreContent from "./more-content";
import { BottomNav } from "@/components/shell/bottom-nav";

export default async function MorePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  return (
    <>
      <Suspense fallback={null}>
        <MoreContent friendCode={session.user.friendCode} />
      </Suspense>
      <BottomNav isAdmin={session.user.isAdmin} />
    </>
  );
}
```

(Removed: `getRepository`/`getUserByEmail`/`User` imports, `initialUser`, `equippedTitle` props.)

- [ ] **Step 2: Derive `equippedTitle` client-side in `more-content.tsx`**

Update the props interface and component signature (currently lines 28-34):

```tsx
interface MoreContentProps {
  friendCode?: string | null
}

export default function MoreContent({ friendCode }: MoreContentProps) {
```

Delete the `initialUser` module seed (lines 35-38):

```tsx
  // DELETE these lines:
  if (initialUser && !_user) {
    _user = initialUser;
  }
```

Change the `equippedTitle` state initializer (lines 46-48) to read from the module-level user:

```tsx
  // Client-overridden value wins; else the last-loaded profile's title.
  const [equippedTitle, setEquippedTitle] = useState<string | null>(
    _equippedTitle !== undefined ? _equippedTitle : (_user?.equippedTitle ?? null)
  );
```

Update the cache seed effect (lines 63-67) to also set the title:

```tsx
  useLayoutEffect(() => {
    if (_user) return;
    const cached = readCacheSync<{ user: User }>('more-user-profile');
    if (cached?.user) {
      _user = cached.user; setUser(cached.user);
      if (_equippedTitle === undefined) setEquippedTitle(cached.user.equippedTitle ?? null);
    }
  }, []);
```

And the network fallback (lines 69-79), same pattern:

```tsx
  useEffect(() => {
    if (_user) return; // already loaded this session
    cachedFetch<{ user: User }>(
      'more-user-profile', '/api/user/profile', TTL_MEDIUM,
      (d) => {
        if (d?.user) {
          _user = d.user; setUser(d.user);
          if (_equippedTitle === undefined) setEquippedTitle(d.user.equippedTitle ?? null);
        }
      },
    ).catch(() => {});
    cachedFetch<{ seasons: Season[] }>(
      'more-seasons', '/api/seasons', TTL_MEDIUM,
      (d) => { if (d?.seasons) { _seasons = d.seasons; setSeasons(d.seasons); } },
    ).catch(() => {});
  }, []);
```

Behaviour tradeoff (accepted): on a completely cold cache the profile name/title appear after one fetch instead of being server-rendered — the same tradeoff every other tab already makes, in exchange for removing a Postgres query from every More visit.

- [ ] **Step 3: Verify on the dev server**

`pnpm exec tsc --noEmit` clean, then in the signed-in browser open `/more`: profile tab shows name, XP and title after first load; reload → they paint instantly from the cache seed.

- [ ] **Step 4: Commit**

```bash
git add app/more/page.tsx app/more/more-content.tsx
git commit -m "Stop querying Postgres on every /more navigation

The page fetched the full user row server-side per visit while the client
already seeds and fetches the same data via more-user-profile. equippedTitle
now derives from that client path (the profile route returns it)."
```

---

### Task 5: Empirically verify the zero-network tab tap

**Files:** none (verification gate for Chunk A)

- [ ] **Step 1: Verify router-cache reuse in the dev browser**

With `pnpm dev` running and signed in: open devtools → Network → filter `_rsc`. Tap Home → Health → Nutrition → Home → Health.
Expected: each tab's **first** visit may issue one `?_rsc=` request; **revisits within 5 minutes issue none**. If revisits still fetch, stop and investigate before landing Chunk A — the whole premise is this reuse (check the Next version's `staleTimes` support and whether the dev overlay is interfering; re-test against `pnpm build && pnpm start` which is authoritative).

- [ ] **Step 2: Record the result in the PR description**

State explicitly: "verified tab revisits issue no `?_rsc=` fetch against a production build (`pnpm start`)" — or what was found instead. Per CLAUDE.md, also state that the on-device (S25 WebView) confirmation has NOT been exercised; it is the device-smoke item added in Task 11.

---

## Chunk B — More-tab pull-to-sync fixes (P3 / NEW-1, NEW-2, NEW-3)

### Task 6: Targeted invalidation + BLE-gated Cloud sync in `handlePullSync`

**Files:**
- Modify: `app/more/more-content.tsx:11-17` (imports), `:81-94` (`handlePullSync`)

Two live bugs in one handler: `invalidateCache('')` wipes **every** cache key app-wide (killing every screen's instant-paint seed — the only surviving instance of this pattern), and the unconditional `POST /api/oura/sync` hits the data-frozen Oura Cloud on every pull. The fix mirrors two existing reference implementations verbatim: `sync-provider.tsx`'s domain-flag invalidation (lines 111-125) and its `maybeSyncOura` BLE-freshness gate (lines 170-181). Note the ring itself is already drained by the shared `PullToSync` component (`lib/oura-ble/sync.ts`, session 233) — this handler only owns the server-sync + cache side.

- [ ] **Step 1: Update imports**

Replace the cache/import lines at the top of `more-content.tsx`:

```tsx
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import {
  invalidateBiometrics, invalidateProgramStructure, invalidateWorkoutSummaries,
  invalidateNutritionWrite, invalidateSupplements, invalidateActivityWrites,
  invalidateInjuryWrites, invalidateOuraSync,
} from "@/lib/cache-groups";
import { isBleDataFresh } from "@/lib/oura/ble-freshness";
```

(`invalidateCache` is dropped — line 93 is its only use in this file; confirm with `grep -n invalidateCache app/more/more-content.tsx`.)

- [ ] **Step 2: Rewrite `handlePullSync`**

```tsx
  const handlePullSync = useCallback(async () => {
    const userId = user?.id;
    if (userId) await pushMutations(userId).catch(() => {});

    // The Cloud sync is data-frozen since the 2026-07-07 re-key — skip it when
    // the direct-BLE pipeline has fresh data (same gate as sync-provider's
    // maybeSyncOura). The ring itself is drained by PullToSync already.
    let bleFresh = false;
    try {
      const freshRes = await fetch('/api/oura-ble/freshness');
      if (freshRes.ok) {
        const { lastMeasuredAt } = await freshRes.json() as { lastMeasuredAt: string | null };
        bleFresh = isBleDataFresh(lastMeasuredAt, Date.now());
      }
    } catch { /* freshness unavailable — fall through to the Cloud sync */ }

    const [deltaResult, ouraResult] = await Promise.allSettled([
      userId ? pullDelta(userId, true) : Promise.resolve(null),
      bleFresh
        ? Promise.resolve(null)
        : fetch('/api/oura/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ daysBack: 7 }),
          }),
    ]);
    if (!bleFresh && ouraResult.status === 'rejected') toast.error('Oura sync failed');

    // Invalidate only what the pull actually changed (mirrors sync-provider.tsx)
    // — never invalidateCache(''), which wipes every screen's instant-paint seed.
    const delta = deltaResult.status === 'fulfilled' ? deltaResult.value : null;
    if (delta && delta.synced > 0) {
      if (delta.domains.biometrics)  await invalidateBiometrics();
      if (delta.domains.programs)    await invalidateProgramStructure();
      if (delta.domains.workouts)    await invalidateWorkoutSummaries();
      if (delta.domains.nutrition)   await invalidateNutritionWrite();
      if (delta.domains.supplements) await invalidateSupplements();
      if (delta.domains.activity)    await invalidateActivityWrites();
      if (delta.domains.injuries)    await invalidateInjuryWrites();
      if (delta.domains.ouraDaily)   await invalidateOuraSync();
    }
    if (!bleFresh && ouraResult.status === 'fulfilled') {
      await invalidateOuraSync();
      await invalidateBiometrics();
    }
  }, [user?.id]);
```

Type note: `pullDelta` returns the delta object with `synced` and per-domain flags — exactly how `sync-provider.tsx:113-125` consumes it; if `tsc` disagrees on the shape, copy the type usage from there, not from memory.

- [ ] **Step 3: Verify on the dev server**

`pnpm exec tsc --noEmit && pnpm lint` clean. In the signed-in browser: open Home (populating its seeds), go to More, pull to sync, then return to Home.
Expected: Home still paints instantly (seeds survive). Before this fix, the same sequence wiped every seed (reproduce once on the pre-fix checkout if you want the contrast). In devtools Network, the pull issues `/api/oura-ble/freshness` and — on the local dev DB, which has no BLE rows — falls through to `/api/oura/sync` (the gate activates only in prod where BLE data exists; that on-device state can't be simulated here).

- [ ] **Step 4: Commit**

```bash
git add app/more/more-content.tsx
git commit -m "Stop More's pull-to-sync wiping the whole cache and hitting the dead Cloud sync

invalidateCache('') cleared every cache key app-wide on each pull,
destroying all screens' instant-paint seeds; now invalidates per pulled
domain exactly like sync-provider. The frozen Oura Cloud sync is gated on
BLE freshness, same as maybeSyncOura."
```

---

### Task 7: `ConfigScreen` loading fallback (NEW-3)

**Files:**
- Modify: `app/more/more-content.tsx:19`

- [ ] **Step 1: Add a loading state to the dynamic import**

```tsx
const ConfigScreen = dynamic(() => import("@/components/config-screen"), {
  ssr: false,
  loading: () => (
    <div className="px-4 pt-4 space-y-3" aria-busy="true">
      <div className="h-24 rounded-2xl bg-muted/40 animate-pulse" />
      <div className="h-24 rounded-2xl bg-muted/40 animate-pulse" />
      <div className="h-24 rounded-2xl bg-muted/40 animate-pulse" />
    </div>
  ),
});
```

(Allowed under the skeleton rule: `ConfigScreen` is a lazily-loaded whole sub-tab that currently renders **nothing** during chunk load — this replaces a blank frame, not a cache-seeded card's paint.)

- [ ] **Step 2: Verify + commit**

Dev server: More → Workout sub-tab shows pulse blocks (throttle the network in devtools to see it) instead of blank, then the config screen.

```bash
git add app/more/more-content.tsx
git commit -m "Show a skeleton instead of a blank frame while ConfigScreen's chunk loads"
```

---

## Chunk C — Fast app open (P2)

### Task 8: Serve cached documents stale-while-revalidate

**Files:**
- Modify: `public/sw-template.js` (the final "Network-first for pages" handler — the last `e.respondWith` block in the fetch listener)

**Baseline: the v1.130.0 offline-shell template** (precache manifest + `META`/previous-generation retention + `OFFLINE_URL` fallback, shipped 2026-07-11 session 271). This task changes only the *online* behaviour of that handler: today it is network-first, so even with a fully warm cache nothing paints until a full round-trip to Railway completes. The activate-time generation retention keeps a cached document's chunks resolvable across one deploy, so serving it stale is safe; the page's content is client-rendered from the local data layer, so a minutes-old document shell shows no stale data. Auth pages are excluded (they must always reflect fresh auth state); this is a single-user app where sign-out is effectively unused, which is why serving a cached authed shell is acceptable — note this tradeoff in the PR.

- [ ] **Step 1: Replace the final network-first handler**

Replace the current final block:

```js
  // Network-first for pages. Cache ok responses; offline, fall back to the exact
  // cached document, then (for a top-level navigation) the precached /offline page
  // instead of a raw Chromium error. res.ok guard stops a 500/redirect poisoning
  // the per-URL cache entry.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(async () => {
        const exact = await caches.match(e.request);
        if (exact) return exact;
        if (e.request.mode === "navigate") {
          const offline = await caches.match(OFFLINE_URL);
          if (offline) return offline;
        }
        return Response.error();
      })
  );
```

with:

```js
  // Top-level navigations: stale-while-revalidate. Serve the cached document
  // instantly (content renders client-side from local data, so a stale shell
  // shows nothing stale) and refresh it in the background for next open. The
  // activate-time generation retention keeps a cached document's chunks
  // resolvable across one deploy. Auth pages stay fresh-only; an uncached
  // navigation falls through network → precached /offline, as before.
  const AUTH_PAGES = ["/sign-in", "/pending", "/register"];
  if (e.request.mode === "navigate" && !AUTH_PAGES.includes(url.pathname)) {
    e.respondWith(
      (async () => {
        const cached = await caches.match(e.request);
        const network = fetch(e.request)
          .then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(CACHE).then((c) => c.put(e.request, clone));
            }
            return res;
          })
          .catch(() => null);
        if (cached) {
          e.waitUntil(network.then(() => undefined));
          return cached;
        }
        const res = await network;
        if (res) return res;
        const offline = await caches.match(OFFLINE_URL);
        return offline ?? Response.error();
      })()
    );
    return;
  }

  // Everything else (RSC payloads, auth pages): network-first with the existing
  // offline fallback to the exact cached response. res.ok guard stops a
  // 500/redirect poisoning the per-URL cache entry.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(async () => {
        const exact = await caches.match(e.request);
        if (exact) return exact;
        return Response.error();
      })
  );
```

Notes: the cached read uses the **global** `caches.match` (not the current-generation cache only) so a document cached under the retained previous generation still serves during the first post-deploy window — the same window the retention feature exists for; the write always goes to the current `CACHE`. `/offline` itself is precached and non-auth, so the SWR branch serves it instantly.

Deliberately **not** done here: stale-while-revalidate for `?_rsc=` payload fetches (they stay network-first). Task 1's `staleTimes` makes the client reuse them without any fetch at all; serving stale Flight payloads from the SW risks version-skew inside a React tree and is only worth revisiting if Task 5's device check fails.

- [ ] **Step 2: Verify against a production build**

```bash
pnpm build && PORT=3100 pnpm start &
```

In a Chromium browser at `http://localhost:3100`: sign in, load `/`, confirm in devtools → Application → Cache Storage that the document is cached. Reload → the document is served by the SW from cache (Network tab shows "(ServiceWorker)" as the source, near-0ms) with a background refresh request following. Then kill the server (`kill %1`) and reload again — the page still opens (offline fallback preserved). Confirm `/sign-in` always hits the network.

- [ ] **Step 3: Commit**

```bash
git add public/sw-template.js
git commit -m "Serve cached documents stale-while-revalidate in the service worker

App open previously blocked on a full network round-trip even with a warm
cache (network-first documents). Same-build cached shells now paint
instantly and refresh in the background; auth pages stay network-first,
offline fallback behaviour is unchanged."
```

---

### Task 9: Stagger the startup warm-fetch fan-out

**Files:**
- Modify: `components/sync-provider.tsx:130-137`

Phase 3 fires ~20 warm fetches (chunked 5-at-a-time) immediately after the push/pull — right when the visible tab's own ~14 fetches are in flight to the same distant server. Give the visible screen the network first.

- [ ] **Step 1: Add a delay before Phase 3**

Replace:

```ts
      // Phase 3: Refresh stale cache entries and fetch any that were missing.
      // Chunked (5 at a time, in CACHE_TASKS order — home-screen keys first) so a
      // cold start doesn't fire ~20 parallel requests and starve the visible tab.
      const WARM_CHUNK = 5;
```

with:

```ts
      // Phase 3: Refresh stale cache entries and fetch any that were missing.
      // Deferred a beat so the visible tab's own fetches win the network first
      // on cold start, then chunked (5 at a time, in CACHE_TASKS order —
      // home-screen keys first) so we never fire ~20 parallel requests.
      await new Promise<void>((resolve) => setTimeout(resolve, 2500));
      if (cancelled) return;
      const WARM_CHUNK = 5;
```

- [ ] **Step 2: Verify + commit**

Dev server, signed in, hard-reload with the Network tab open: the `CACHE_TASKS` URLs (`/api/weights-summary`, `/api/exercise-library`, …) now start ~2.5s after load, after the home screen's own fetches. All entries still warm (check sessionStorage mirrors exist for e.g. `weights-summary` afterwards).

```bash
git add components/sync-provider.tsx
git commit -m "Defer the startup cache-warm fan-out so the visible tab's fetches win the network"
```

---

### Task 10: Native splash screen (owner APK rebuild required)

**Files:**
- Modify: `package.json` + `pnpm-lock.yaml` (new dep)
- Modify: `capacitor.config.ts`
- Modify: `components/capacitor-native-init.tsx:16-25`

Cold start currently shows a solid `#09090b` void for the entire remote-WebView load. A splash with branding makes the same wait read as "app starting" instead of "app frozen". **The native half is sandbox-unverifiable** (no Android SDK; per CLAUDE.md, Kotlin/native changes are compile-gated only) and needs `npx cap sync android && ./gradlew assembleDebug` by the owner — state this in the PR and batch with the next scheduled rebuild if one is pending.

- [ ] **Step 1: Add the plugin**

```bash
pnpm add @capacitor/splash-screen@^8
```

Commit `package.json` and `pnpm-lock.yaml` together (project rule).

- [ ] **Step 2: Configure it in `capacitor.config.ts`**

```ts
const config: CapacitorConfig = {
  appId: 'com.trainingai.app',
  appName: 'TrainingAi',
  // Load from Railway — all server-side features (API routes, auth) stay on Railway.
  // UI changes deploy via Railway and appear in the APK without a rebuild.
  server: {
    url: 'https://trainingai-production.up.railway.app',
    cleartext: false,
  },
  android: {
    backgroundColor: '#09090b',
  },
  plugins: {
    SplashScreen: {
      // Remote WebView: hold the splash while the document loads, but never
      // hang on it — auto-hide caps the wait even if JS never runs (offline
      // cold start on a wiped cache). CapacitorNativeInit hides it earlier on mount.
      launchShowDuration: 5000,
      launchAutoHide: true,
      backgroundColor: '#09090b',
      showSpinner: false,
    },
  },
};
```

- [ ] **Step 3: Hide the splash as soon as the web app mounts**

In `components/capacitor-native-init.tsx`, immediately after the `isNativePlatform` guard (line 18), before the StatusBar block:

```ts
      try {
        const { SplashScreen } = await import('@capacitor/splash-screen');
        await SplashScreen.hide();
      } catch {
        // Plugin absent on pre-rebuild APKs — auto-hide covers it
      }
```

(Guarded dynamic import in try/catch — the mandated Capacitor plugin pattern; an APK built before this change simply no-ops.)

- [ ] **Step 4: Gate + commit**

`pnpm exec tsc --noEmit && pnpm lint && pnpm build` all clean (the plugin is web-safe; the import only runs native-side).

```bash
git add package.json pnpm-lock.yaml capacitor.config.ts components/capacitor-native-init.tsx
git commit -m "Show a splash screen during cold start instead of a blank void

The remote WebView shows solid #09090b for the whole document load. The
splash auto-hides at 5s as a hang-safety and JS hides it on mount.
Requires an owner APK rebuild to take effect."
```

---

## Task 11: Gate, docs, version, device-smoke additions

**Files:**
- Modify: `docs/device-smoke-checklist.md`
- Modify: `docs/module-map.md`
- Modify: `package.json` (version) + `lib/changelog.ts`
- Modify: `docs/implementation-backlog.md` (remove this item's entry)
- Modify: `projectOverview.md` + `docs/overview/history-current.md` (session bookkeeping)

- [ ] **Step 1: Full gate**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: all clean/green. Then the dev-server sweep: sign in, visit all five tabs, tap between them repeatedly, pull-to-sync on More, reload — no console errors, instant repeat paints, seeds intact.

- [ ] **Step 2: Add device-smoke checks**

Append to `docs/device-smoke-checklist.md`:

```markdown
## Instant nav & app open (2026-07-11 plan)
- [ ] Tab taps: with remote devtools (chrome://inspect) attached, tap between all five tabs — revisits within ~5 min issue NO `?_rsc=` network requests and paint instantly.
- [ ] Cold open (app killed, warm cache): the splash shows, and the home screen paints in well under the previous multi-second wait; airplane-mode cold open still reaches the offline behaviour (the offline-shell checklist section).
- [ ] More → pull-to-sync, then visit Home/Health/Nutrition: all paint instantly (no skeleton wall — the cache-wipe regression stays dead).
- [ ] First open after a deploy: expect the one-time slower load (full re-download) — verify the SECOND open is instant again.
```

- [ ] **Step 3: Module map + changelog + version**

Add a one-line row for `components/shell/tab-loading.tsx` to `docs/module-map.md`'s UI-primitives section. Bump `package.json` version **minor** (user-visible: navigation/startup behaviour) and add a `lib/changelog.ts` entry, e.g. "Instant tab switching and faster app open — navigation reuses cached screens instead of refetching, cached app shell paints immediately on open, More-tab pull-to-sync no longer clears cached screens, splash screen on launch (APK rebuild)."

- [ ] **Step 4: Backlog + journal bookkeeping in the same PR**

Remove this item's entry from `docs/implementation-backlog.md` (or annotate what remains if landed partially). Update the two `projectOverview.md` Known-Issues rows this plan resolves (the More-tab cache-wipe row and the structural-latency row) and append the session journal entry per CLAUDE.md.

- [ ] **Step 5: Final commit + PR**

Present per CLAUDE.md: state which surfaces were NOT exercised (everything on-device: WebView router-cache behaviour, splash, real-RTT timings — plus the BLE-freshness gate's fresh-data branch, absent on the dev DB), and ask for merge confirmation.

---

## Self-review notes (spec coverage)

- Review §5-P1: staleTimes → Task 1; loading.tsx → Tasks 2-3; /more de-DB → Task 4; P1.4 (middleware `_rsc` matcher / SW RSC-SWR) → deliberately out of scope (Task 8 note) unless Task 5's verification fails.
- Review §5-P2: document SWR → Task 8 (written against the shipped v1.130.0 SW template); splash → Task 10; stampede stagger → Task 9; `reconcileSchema` PRAGMA batching → **deliberately dropped** (doesn't block first paint; revisit only if device profiling shows it matters).
- Review §5-P3: NEW-1/NEW-2 → Task 6; NEW-3 → Task 7.
- Review §5-P4 (bundled shell / client-side tab shell) → NOT this plan; remains the unqueued Track A endgame bullet in the backlog.
