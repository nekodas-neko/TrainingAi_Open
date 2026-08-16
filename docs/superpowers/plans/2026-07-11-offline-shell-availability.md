# Offline Shell Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app cold-start and navigate with no reception — precache the immutable static-asset set per build, keep the previous cache generation across deploys, serve a precached `/offline` fallback instead of the Chromium error page, and give the shell an offline-aware UI.

**Architecture:** The APK is a remote Capacitor WebView pointed at the Railway URL (`capacitor.config.ts` `server.url`) with no bundled assets, so offline availability is 100% whatever the service worker (`public/sw-template.js`, served build-stamped via `app/sw.js/route.ts`) has cached. Today it precaches nothing, wipes its whole cache every deploy, and has no fallback — reproduced in `docs/reviews/2026-07-11-offline-support-review.md`. This plan makes the SW precache all content-hashed `_next/static` assets at install, retain the current + previous cache generation across deploys, and fall back to a precached unauthenticated `/offline` document; plus a client offline indicator and nav-preserving error boundaries. The **data layer is already offline-capable** and is out of scope (owned by R3 / backlog items 8, 10).

**Tech Stack:** Next.js 15 App Router, TypeScript, a hand-written service worker (plain JS template with token injection), Vitest (node env — pure functions only; DOM/SW behaviour is verified via the review's Playwright prod-build harness + on-device smoke), Tailwind v4, Capacitor `@capacitor/network`.

---

## Scope note

Four independently-landable chunks. Chunks 1–2 are the outage fix (shell loads + navigates offline) and should land together or 1-then-2. Chunks 3–4 are polish/observability and can land separately. No schema changes, no APK rebuild — all of this ships to the device via a normal Railway deploy into the WebView + service worker.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `lib/sw/manifest.ts` | Create | Pure functions: walk `.next/static` → precache URL list; inject cache name + manifest into the SW template. Node-testable. |
| `lib/sw/__tests__/manifest.test.ts` | Create | Unit tests for the above against a temp-dir fixture. |
| `app/sw.js/route.ts` | Modify | Compute the precache list at request time (memoized by build id) and inject it alongside the cache name. |
| `public/sw-template.js` | Modify | Install-time precache, previous-generation retention on activate, `res.ok`-guarded puts, navigation → `/offline` fallback chain, drop the force-reload. |
| `app/offline/page.tsx` | Create | Static, unauthenticated offline fallback document (precached). |
| `app/offline/offline-actions.tsx` | Create | Tiny client child for the "Try again" reload button (keeps the page static). |
| `middleware.ts` | Modify | Treat `/offline` as public so it never redirects to `/sign-in` (cache-poisoning guard). |
| `lib/use-online-status.ts` | Create | `useOnlineStatus()` hook — `navigator.onLine` + online/offline events + Capacitor Network. |
| `components/shell/offline-indicator.tsx` | Create | Fixed "Offline — showing saved data" pill; renders only when offline. |
| `app/layout.tsx` | Modify | Mount `<OfflineIndicator />`. |
| `app/error.tsx` | Modify | Offline-aware root error boundary that keeps the bottom nav and auto-recovers on reconnect. |
| `app/workout/error.tsx` | Modify | Same treatment for the workout boundary. |
| `lib/cache-ttl.ts` | Modify | Add `OFFLINE_SEED_TTL_FLOOR` (7 d) + `floorSeedTtl()`. |
| `lib/cache-ttl.test.ts` | Create | Unit test the floor helper. |
| `lib/sqlite/cache.ts` | Modify | Use `floorSeedTtl()` for the localStorage seed TTL. |
| `components/more/sw-status-row.tsx` | Create | Diagnostics row: SW controller state + cache generation/precache count. |
| `components/more/profile-tab.tsx` | Modify | Mount the diagnostics row in the About card. |
| `docs/device-smoke-checklist.md` | Modify | Add an airplane-mode offline-shell section (the merge gate). |

---

## Chunk 1 — Service worker: precache, survive deploys, never show the dinosaur

### Task 1: Precache-manifest pure module

**Files:**
- Create: `lib/sw/manifest.ts`
- Test: `lib/sw/__tests__/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/sw/__tests__/manifest.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  listStaticAssets,
  buildPrecacheList,
  renderServiceWorker,
  EXTRA_PRECACHE_URLS,
} from '../manifest'

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sw-static-'))
  mkdirSync(join(dir, 'chunks'), { recursive: true })
  writeFileSync(join(dir, 'chunks', 'app.js'), '//app')
  writeFileSync(join(dir, 'chunks', 'app.js.map'), '{}')
  mkdirSync(join(dir, 'css'), { recursive: true })
  writeFileSync(join(dir, 'css', 'x.css'), 'a{}')
  return dir
}

describe('listStaticAssets', () => {
  it('lists files as /_next/static URLs and excludes .map', () => {
    const urls = listStaticAssets(fixtureDir())
    expect(urls).toContain('/_next/static/chunks/app.js')
    expect(urls).toContain('/_next/static/css/x.css')
    expect(urls).not.toContain('/_next/static/chunks/app.js.map')
  })
  it('returns [] for a missing dir (dev / no build)', () => {
    expect(listStaticAssets('/no/such/dir/xyz')).toEqual([])
  })
})

describe('buildPrecacheList', () => {
  it('prepends the extra URLs (offline page) to the static assets', () => {
    const list = buildPrecacheList(fixtureDir())
    for (const u of EXTRA_PRECACHE_URLS) expect(list).toContain(u)
    expect(list).toContain('/_next/static/css/x.css')
  })
})

describe('renderServiceWorker', () => {
  it('injects the cache name and a JSON-parseable precache manifest', () => {
    const template = 'const CACHE="__CACHE_NAME__"; const P=__PRECACHE_URLS__;'
    const body = renderServiceWorker(template, {
      cacheName: 'ta-abc123',
      precacheUrls: ['/offline', '/_next/static/css/x.css'],
    })
    expect(body).toContain('const CACHE="ta-abc123"')
    const m = body.match(/const P=(\[.*\]);/)!
    expect(JSON.parse(m[1])).toEqual(['/offline', '/_next/static/css/x.css'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run lib/sw/__tests__/manifest.test.ts`
Expected: FAIL — `Cannot find module '../manifest'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/sw/manifest.ts
import { readdirSync } from 'fs'
import { join } from 'path'

// Recursively list every file under staticDir as a /_next/static/... URL. These
// are content-hashed and immutable, so precaching the full set per build is safe
// and is what makes lazy route chunks available offline (the "Loading chunk
// failed" dead-end). .map files are dev-only sourcemaps and never requested by
// the running app, so they are excluded to keep the precache lean.
export function listStaticAssets(staticDir: string): string[] {
  const urls: string[] = []
  function walk(dir: string, prefix: string): void {
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // missing dir (dev / pre-build) — no static assets to precache
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else if (!entry.name.endsWith('.map')) urls.push(`/_next/static/${rel}`)
    }
  }
  walk(staticDir, '')
  return urls.sort()
}

// Always-precache entries beyond the static assets. Only the offline fallback
// document — the app icons are dynamic routes (app/icon.tsx), not static files,
// and the offline page uses an inline Lucide icon so it needs no network image.
export const EXTRA_PRECACHE_URLS = ['/offline']

export function buildPrecacheList(staticDir: string): string[] {
  return [...EXTRA_PRECACHE_URLS, ...listStaticAssets(staticDir)]
}

// Inject the build-stamped cache name and the precache manifest into the SW
// template. Each token appears exactly once in public/sw-template.js.
export function renderServiceWorker(
  template: string,
  opts: { cacheName: string; precacheUrls: string[] },
): string {
  return template
    .replace('__CACHE_NAME__', opts.cacheName)
    .replace('__PRECACHE_URLS__', JSON.stringify(opts.precacheUrls))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run lib/sw/__tests__/manifest.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sw/manifest.ts lib/sw/__tests__/manifest.test.ts
git commit -m "Add service-worker precache-manifest builder"
```

### Task 2: Wire the manifest into the SW route

**Files:**
- Modify: `app/sw.js/route.ts`

- [ ] **Step 1: Replace the route body**

Replace the entire contents of `app/sw.js/route.ts` with:

```ts
import { readFileSync } from "fs";
import { join } from "path";
import { buildPrecacheList, renderServiceWorker } from "@/lib/sw/manifest";

// Serves the service worker from a template with the cache name build-stamped in
// (one cache name per deploy — no manual bump, forgotten twice historically) and
// a per-build precache manifest of every immutable _next/static asset injected,
// so the APK can cold-start and navigate offline. `public/sw-template.js` (not
// `public/sw.js`) so Next's static file serving never shadows this route.
const TEMPLATE_PATH = join(process.cwd(), "public", "sw-template.js");
const STATIC_DIR = join(process.cwd(), ".next", "static");
const BUILD_ID = process.env.RAILWAY_GIT_COMMIT_SHA ?? String(Date.now());

// BUILD_ID is constant for the process lifetime, so the (potentially large)
// static-dir walk runs once, not on every SW fetch.
let _cached: { buildId: string; body: string } | null = null;

export async function GET() {
  if (!_cached || _cached.buildId !== BUILD_ID) {
    const template = readFileSync(TEMPLATE_PATH, "utf-8");
    const body = renderServiceWorker(template, {
      cacheName: `ta-${BUILD_ID.slice(0, 12)}`,
      precacheUrls: buildPrecacheList(STATIC_DIR),
    });
    _cached = { buildId: BUILD_ID, body };
  }
  return new Response(_cached.body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Never let the browser cache this response — it must always re-check for a
      // new build id, or SW updates would never be detected.
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    },
  });
}
```

- [ ] **Step 2: Verify it compiles and serves a manifest**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Then (against a production build so `.next/static` exists):
```bash
unset DATABASE_URL DATABASE_SSL && pnpm build && (PORT=3100 pnpm start &) && sleep 6 \
  && curl -s localhost:3100/sw.js | grep -c '_next/static'
```
Expected: a count ≳ 50 (the injected `PRECACHE_URLS`), and `curl -s localhost:3100/sw.js | grep -c '/offline'` ≥ 1.

- [ ] **Step 3: Commit**

```bash
git add app/sw.js/route.ts
git commit -m "Inject per-build precache manifest into the service worker"
```

### Task 3: Rewrite the service worker template

**Files:**
- Modify: `public/sw-template.js`

- [ ] **Step 1: Replace the file**

Replace the entire contents of `public/sw-template.js` with the following. Changes vs. today: install precaches `PRECACHE_URLS`; activate retains the current + previous cache generation (via a persistent `ta-meta` cache) instead of wiping everything, and no longer force-reloads open clients; the page/static handlers only `put` `res.ok` responses; navigations fall back to the precached `/offline` document. The `exercise-media`, `exercise-gif`, `/api/`, push and notificationclick handlers are unchanged.

```js
const CACHE = "__CACHE_NAME__";
const PRECACHE_URLS = __PRECACHE_URLS__;
const META = "ta-meta";           // persistent — holds the previous build's cache name
const OFFLINE_URL = "/offline";

self.addEventListener("install", (e) => {
  // Precache the immutable static asset set + the offline fallback document.
  // allSettled (not cache.addAll): one transient 404/opaque response must not
  // fail the whole install. Authenticated documents are still NOT precached —
  // only content-hashed statics and the unauthenticated /offline page.
  e.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // Retain the current build's cache AND the immediately-previous one, so a
      // deploy no longer empties offline coverage. `ta-meta.prev` points at the
      // build that was current as of the last activation; keep it + the new
      // current, delete everything older, then record the new current as prev.
      const meta = await caches.open(META);
      const prevRes = await meta.match("prev");
      const prev = prevRes ? await prevRes.text() : null;
      const keep = new Set([CACHE, META, ...(prev ? [prev] : [])]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      await meta.put("prev", new Response(CACHE));
      await self.clients.claim();
      // No client.navigate() force-reload: the retained previous generation keeps
      // already-open pages' chunks resolvable, so the new build is adopted on the
      // next natural navigation instead of yanking the user (mid-workout included).
    })()
  );
});

self.addEventListener("push", (e) => {
  if (!e.data) return;
  let payload;
  try { payload = e.data.json(); } catch { payload = { title: "TrainingAI", body: e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(payload.title ?? "TrainingAI", {
      body: payload.body,
      icon: payload.icon ?? "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url ?? "/" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url ?? "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url === url);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Cache-first for exercise media binaries (GIFs and frames stored in S3).
  if (url.pathname.includes("/exercise-media/")) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Stale-while-revalidate for exercise GIF URL lookups.
  if (url.pathname === "/api/exercise-gif") {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(e.request);
        const fetchPromise = fetch(e.request)
          .then((res) => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => null);
        return cached ?? (await fetchPromise);
      })
    );
    return;
  }

  // Never cache other API calls — always go to network.
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Cache-first for static assets (_next/static). Only store ok responses.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

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
});
```

- [ ] **Step 2: Verify the injected SW is valid JS**

Run (production server from Task 2 still up, or restart it):
```bash
curl -s localhost:3100/sw.js -o /tmp/sw-check.js && node --check /tmp/sw-check.js && echo "SW parses OK"
```
Expected: `SW parses OK` (confirms `__PRECACHE_URLS__` injected as valid JSON and the template has no syntax errors).

- [ ] **Step 3: Commit**

```bash
git add public/sw-template.js
git commit -m "Precache statics, retain previous cache generation, offline fallback in SW"
```

### Task 4: The `/offline` fallback page

**Files:**
- Create: `app/offline/page.tsx`
- Create: `app/offline/offline-actions.tsx`

- [ ] **Step 1: Write the client actions child**

```tsx
// app/offline/offline-actions.tsx
"use client";

import { Button } from "@/components/ui/button";

export function OfflineActions() {
  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        className="bg-brand text-white hover:opacity-90"
        onClick={() => window.location.reload()}
      >
        Try again
      </Button>
      {/* Plain <a>, not next/link — a full navigation the SW serves from cache. */}
      <a href="/" className="text-sm text-muted-foreground underline underline-offset-4">
        Go to Home
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Write the static offline page**

```tsx
// app/offline/page.tsx
import { WifiOffIcon } from "lucide-react";
import { OfflineActions } from "./offline-actions";

// Static + unauthenticated so it can be precached and served with no network and
// no session. MUST stay logic-free (no auth(), no data fetches) — any dependency
// here becomes its own offline failure mode.
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <div className="pt-safe flex min-h-screen flex-col items-center justify-center gap-5 bg-page px-6 text-center">
      <WifiOffIcon className="h-12 w-12 text-muted-foreground" />
      <div>
        <h1 className="text-xl font-bold">You&apos;re offline</h1>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          This screen needs a connection. Your saved data is still on the other
          tabs — reconnect to load this one.
        </p>
      </div>
      <OfflineActions />
    </div>
  );
}
```

- [ ] **Step 3: Verify it renders and is static**

Run: `pnpm exec tsc --noEmit` (expected: clean), then `curl -s localhost:3100/offline | grep -c "You&#x27;re offline"` after a rebuild+restart — expected: ≥ 1.

- [ ] **Step 4: Commit**

```bash
git add app/offline/page.tsx app/offline/offline-actions.tsx
git commit -m "Add precached /offline fallback page"
```

### Task 5: Exclude `/offline` from auth redirects

**Files:**
- Modify: `middleware.ts:7`

- [ ] **Step 1: Add `/offline` to PUBLIC_PATHS**

Change line 7 from:
```ts
const PUBLIC_PATHS = ["/sign-in", "/pending", "/register"]
```
to:
```ts
const PUBLIC_PATHS = ["/sign-in", "/pending", "/register", "/offline"]
```

Rationale: without this, an unauthenticated fetch of `/offline` (e.g. the SW `cache.add('/offline')` at install if the session cookie is momentarily absent) would be redirected to `/sign-in` and that redirect cached as the "offline page", poisoning the fallback.

- [ ] **Step 2: Verify**

Run: `pnpm exec tsc --noEmit` (clean). Then `curl -s -o /dev/null -w "%{http_code}\n" localhost:3100/offline` with no auth cookie → expected `200` (not a 307 to `/sign-in`).

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "Treat /offline as a public route so it never redirects"
```

### Task 6: End-to-end offline repro (the in-sandbox behavioural gate)

**Files:** none (uses the review's Playwright harness in the scratchpad).

- [ ] **Step 1: Re-run the review's offline repro against a fresh production build**

Rebuild and restart the production server (Task 2's build), then run the offline reproduction from `docs/reviews/2026-07-11-offline-support-review.md` (sign in → browse online → kill the server → cold-start at `/workout`, warm-nav to each tab). Chromium at `/opt/pw-browsers/chromium` via `playwright-core` in the scratchpad; offline is simulated by killing the server (`context.setOffline` does NOT apply to SW fetches).

- [ ] **Step 2: Confirm the fixed behaviour**

Expected, versus the review's "before" table:
- Offline **cold start at `/workout`** → renders the `/offline` page (was `net::ERR_FAILED`).
- Offline **warm tab-tap to an unvisited tab** → renders the screen from the precached chunks (no "Loading chunk failed"); if a genuinely uncached document is hit, the `/offline` page shows with the bottom nav (Chunk 2), not a dead-end.
- Offline **cold start at `/`** → still renders Home directly.

Record the results in the PR description. If a tab still fails, the precache manifest is likely missing that route's chunks — re-check `curl localhost:3100/sw.js | grep -c _next/static` covers the app chunks.

- [ ] **Step 3: Commit** (no code — this is a verification gate; note the outcome in the PR)

---

## Chunk 2 — Client shell: offline is a state, not an error

### Task 7: `useOnlineStatus` hook

**Files:**
- Create: `lib/use-online-status.ts`

- [ ] **Step 1: Write the hook**

```ts
// lib/use-online-status.ts
"use client";

import { useEffect, useState } from "react";

// True when the device believes it has connectivity. Defaults to true (SSR-safe,
// avoids an offline-pill flash for online users) and corrects on mount. Uses the
// DOM online/offline events plus Capacitor Network, which is more reliable than
// navigator.onLine inside the Android WebView.
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);

    let removeNative = () => {};
    import("@capacitor/network")
      .then(({ Network }) =>
        Network.addListener("networkStatusChange", (s) => setOnline(s.connected)).then((h) => {
          removeNative = () => h.remove();
        }),
      )
      .catch(() => {}); // web / plugin unavailable — DOM events are enough

    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      removeNative();
    };
  }, []);

  return online;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm exec tsc --noEmit`
Expected: clean. (No unit test — the hook is DOM/plugin-bound; behaviour is covered by Task 8's Playwright check and on-device smoke.)

- [ ] **Step 3: Commit**

```bash
git add lib/use-online-status.ts
git commit -m "Add useOnlineStatus hook"
```

### Task 8: Offline indicator pill

**Files:**
- Create: `components/shell/offline-indicator.tsx`
- Modify: `app/layout.tsx:106` (mount after `<Toaster />`)

- [ ] **Step 1: Write the component**

```tsx
// components/shell/offline-indicator.tsx
"use client";

import { WifiOffIcon } from "lucide-react";
import { useOnlineStatus } from "@/lib/use-online-status";

export function OfflineIndicator() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1 text-xs font-medium text-muted-foreground shadow-md backdrop-blur-sm"
      // Clear the 3.5rem (h-14) bottom nav + safe-area, per the floating-element rule.
      style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom) + 0.5rem)" }}
    >
      <WifiOffIcon className="h-3.5 w-3.5" />
      Offline — showing saved data
    </div>
  );
}
```

- [ ] **Step 2: Mount it in the root layout**

In `app/layout.tsx`, add the import near the other `components/shell` import:
```tsx
import { OfflineIndicator } from "@/components/shell/offline-indicator";
```
and add the element immediately after `<Toaster />` (line 106):
```tsx
            <Toaster />
            <OfflineIndicator />
```

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc --noEmit` (clean). Then, via the Playwright harness against the running prod server: sign in, `await context.setOffline(true)`, and assert the pill text `Offline — showing saved data` becomes visible; `setOffline(false)` → it disappears. (`setOffline` fires the DOM `offline`/`online` events even though it doesn't affect SW fetches, so the pill IS exercisable in-sandbox.)

- [ ] **Step 4: Commit**

```bash
git add components/shell/offline-indicator.tsx app/layout.tsx
git commit -m "Add offline indicator pill to the app shell"
```

### Task 9: Offline-aware error boundaries that keep the nav

**Files:**
- Modify: `app/error.tsx`
- Modify: `app/workout/error.tsx`

- [ ] **Step 1: Replace `app/error.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TriangleAlertIcon, WifiOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/shell/bottom-nav";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
    setOffline(isOffline);
    // Only report genuine (online) errors — an offline chunk-load failure is
    // expected, and the report fetch would fail anyway.
    if (!isOffline) {
      console.error("Root error boundary caught:", error);
      const body = JSON.stringify({ message: error.message, stack: error.stack, url: window.location.href });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/client-error", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    }
    // Auto-recover when connectivity returns.
    const onOnline = () => reset();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [error, reset]);

  return (
    <>
      <div className="flex h-screen flex-col items-center justify-center gap-5 bg-page px-6 text-center">
        {offline ? (
          <>
            <WifiOffIcon className="h-12 w-12 text-muted-foreground" />
            <div>
              <h2 className="text-xl font-bold">You&apos;re offline</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                This screen needs a connection. Your saved data is on the other tabs.
              </p>
            </div>
            <Button className="bg-brand text-white hover:opacity-90" onClick={reset}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <TriangleAlertIcon className="h-12 w-12 text-amber-500" />
            <div>
              <h2 className="text-xl font-bold">Something went wrong</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your data is safe. Tap below to reload this screen.
              </p>
              <p className="mt-3 max-w-xs break-all font-mono text-xs text-red-400">{error?.message}</p>
            </div>
            <Button className="bg-brand text-white hover:opacity-90" onClick={reset}>
              Try again
            </Button>
            <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
              Go to home
            </Link>
          </>
        )}
      </div>
      {/* Keep a way out — the boundary previously dead-ended with no nav. */}
      <BottomNav />
    </>
  );
}
```

- [ ] **Step 2: Replace `app/workout/error.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TriangleAlertIcon, WifiOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/shell/bottom-nav";

export default function WorkoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(typeof navigator !== "undefined" && !navigator.onLine);
    if (typeof navigator === "undefined" || navigator.onLine) {
      console.error("Workout error boundary caught:", error);
    }
    const onOnline = () => reset();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [error, reset]);

  return (
    <>
      <div className="flex h-screen flex-col items-center justify-center gap-5 bg-page px-6 text-center">
        {offline ? (
          <>
            <WifiOffIcon className="h-12 w-12 text-muted-foreground" />
            <div>
              <h2 className="text-xl font-bold">You&apos;re offline</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your workout data has been saved. Reconnect to reload this screen.
              </p>
            </div>
            <Button className="bg-brand text-white hover:opacity-90" onClick={reset}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <TriangleAlertIcon className="h-12 w-12 text-amber-500" />
            <div>
              <h2 className="text-xl font-bold">Something went wrong</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your workout data has been saved. Tap below to recover.
              </p>
              <p className="mt-3 max-w-xs break-all font-mono text-xs text-red-400">{error?.message}</p>
            </div>
            <Button className="bg-brand text-white hover:opacity-90" onClick={reset}>
              Try again
            </Button>
            <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
              Go to home
            </Link>
          </>
        )}
      </div>
      <BottomNav />
    </>
  );
}
```

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc --noEmit` (clean) and `pnpm lint` (clean). Behavioural check via the Task 6 repro: an offline navigation that lands in the boundary now shows the "You're offline" copy **with the bottom nav rendered**, and restoring connectivity auto-triggers `reset()`.

- [ ] **Step 4: Commit**

```bash
git add app/error.tsx app/workout/error.tsx
git commit -m "Make error boundaries offline-aware and keep the bottom nav"
```

---

## Chunk 3 — Data-layer offline polish

### Task 10: Offline seed TTL floor

**Files:**
- Modify: `lib/cache-ttl.ts`
- Test: `lib/cache-ttl.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/cache-ttl.test.ts
import { describe, it, expect } from 'vitest'
import { floorSeedTtl, OFFLINE_SEED_TTL_FLOOR, TTL_SHORT } from './cache-ttl'

describe('floorSeedTtl', () => {
  it('floors a short TTL up to the offline seed floor', () => {
    expect(floorSeedTtl(TTL_SHORT)).toBe(OFFLINE_SEED_TTL_FLOOR)
  })
  it('leaves a TTL longer than the floor untouched', () => {
    const longer = OFFLINE_SEED_TTL_FLOOR + 1000
    expect(floorSeedTtl(longer)).toBe(longer)
  })
  it('the floor is 7 days in seconds', () => {
    expect(OFFLINE_SEED_TTL_FLOOR).toBe(7 * 24 * 60 * 60)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm exec vitest run lib/cache-ttl.test.ts`
Expected: FAIL — `floorSeedTtl` / `OFFLINE_SEED_TTL_FLOOR` are not exported.

- [ ] **Step 3: Add the constant + helper to `lib/cache-ttl.ts`**

Append to `lib/cache-ttl.ts`:
```ts
// Offline seed floor — the localStorage cache seed (readCacheSync's fallback) is
// kept at least this long regardless of the key's real TTL, so a fully-offline
// device still paints last-known data. Raised from 24h to 7d (offline-shell work,
// 2026-07-11). This only governs how long a seed survives WITHOUT a successful
// refetch — online freshness is unchanged (SWR refetch still fires every mount).
export const OFFLINE_SEED_TTL_FLOOR = 7 * 24 * 60 * 60;

export function floorSeedTtl(ttlSeconds: number): number {
  return Math.max(ttlSeconds, OFFLINE_SEED_TTL_FLOOR);
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm exec vitest run lib/cache-ttl.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/cache-ttl.ts lib/cache-ttl.test.ts
git commit -m "Add 7-day offline seed TTL floor helper"
```

### Task 11: Use the floor in the cache seed write

**Files:**
- Modify: `lib/sqlite/cache.ts:1` (import) and `:106` (the `lsSet` call)

- [ ] **Step 1: Add the import**

At the top of `lib/sqlite/cache.ts`, next to the existing imports:
```ts
import { floorSeedTtl } from '@/lib/cache-ttl';
```

- [ ] **Step 2: Replace the hardcoded 24h floor**

In `setCached` (`lib/sqlite/cache.ts:101-118`), change the localStorage write. Replace:
```ts
  // Always write localStorage: it survives APK kills so readCacheSync can serve
  // instant data on relaunch. Use at least 6h so even TTL_SHORT entries persist
  // across typical session gaps — stale-while-revalidate handles freshness.
  lsSet(key, data, Math.max(ttlSeconds, 24 * 60 * 60));
```
with:
```ts
  // Always write localStorage: it survives APK kills so readCacheSync can serve
  // instant data on relaunch, and floors the seed to OFFLINE_SEED_TTL_FLOOR (7d)
  // so a fully-offline device keeps painting last-known data. SWR handles
  // freshness whenever the network returns.
  lsSet(key, data, floorSeedTtl(ttlSeconds));
```

Note: the SQLite `api_cache` layer (line 108-115) still expires at the real per-call `ttlSeconds` — that is deliberate (freshness for the online hot path); the localStorage seed is the offline fallback whose lifetime we are extending. Do not change the SQLite TTL.

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc --noEmit` (clean) and `pnpm test` (full suite green — confirms nothing that imports `cache.ts` regressed).

- [ ] **Step 4: Commit**

```bash
git add lib/sqlite/cache.ts
git commit -m "Extend offline cache-seed lifetime to 7 days"
```

**Deferred (not a task) — D1, today-guarded stale reads.** After local midnight offline, the six date-enveloped keys (readiness, body-battery, training-load, weekly-stats, progress-summary, health-trends) blank rather than serve yesterday-as-today (`lib/sqlite/cache.ts` `unwrapToday`). Serving a labelled "from yesterday · offline" stale value is possible but recreates the session-52 stale-across-midnight bug class if mislabelled, so it is **left out pending owner sign-off** — do not build it in this plan.

---

## Chunk 4 — Verification & observability

### Task 12: Service-worker health diagnostics row

**Files:**
- Create: `components/more/sw-status-row.tsx`
- Modify: `components/more/profile-tab.tsx:599` (mount after `<UpdateCheckCard />`)

- [ ] **Step 1: Write the component**

```tsx
// components/more/sw-status-row.tsx
"use client";

import { useEffect, useState } from "react";

// Surfaces whether the service worker is actually alive in this WebView (SW
// registration failure is otherwise silently swallowed) and how much is cached.
export function ServiceWorkerStatusRow() {
  const [state, setState] = useState<{ controller: boolean; generations: number; precache: number } | null>(null);

  useEffect(() => {
    (async () => {
      const controller = typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller;
      let generations = 0;
      let precache = 0;
      try {
        const names = await caches.keys();
        const buildCaches = names.filter((n) => n.startsWith("ta-") && n !== "ta-meta");
        generations = buildCaches.length;
        // The current build's cache is the one whose /offline entry exists.
        for (const n of buildCaches) {
          const c = await caches.open(n);
          const count = (await c.keys()).length;
          if (count > precache) precache = count;
        }
      } catch { /* CacheStorage unavailable */ }
      setState({ controller, generations, precache });
    })();
  }, []);

  if (!state) return null;
  return (
    <div className="px-4 py-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Offline cache
      </p>
      <p className="text-xs text-muted-foreground">
        Service worker {state.controller ? "active" : "not active"} · {state.precache} files cached · {state.generations} generation(s)
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in the About card**

In `components/more/profile-tab.tsx`, add the import near the other `components/more` imports:
```tsx
import { ServiceWorkerStatusRow } from "@/components/more/sw-status-row";
```
and insert the element immediately after `<UpdateCheckCard />` (line 599):
```tsx
          <UpdateCheckCard />
          <ServiceWorkerStatusRow />
```

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc --noEmit` (clean) and `pnpm lint` (clean). The row renders in More → About; on-device it reports `Service worker active` once the SW controls the page.

- [ ] **Step 4: Commit**

```bash
git add components/more/sw-status-row.tsx components/more/profile-tab.tsx
git commit -m "Add service-worker health diagnostics row to More"
```

### Task 13: Device smoke checklist — offline-shell section

**Files:**
- Modify: `docs/device-smoke-checklist.md`

- [ ] **Step 1: Add a new section after "## 2. Offline round-trip"**

Insert:
```markdown
## 2b. Offline shell availability (the merge gate for the offline-shell change)

- With the app open and online, browse Home once so the SW is installed and
  precaching has run (More → About shows "Service worker active").
- Enable airplane mode. Force-close the app (recent-apps swipe-away). Reopen —
  confirm it cold-starts to Home, not a blank/error page.
- Still offline, tap every bottom-nav tab (Home, Workout, Nutrition, Health,
  More). Confirm each renders its saved data with the "Offline — showing saved
  data" pill, and NONE shows a Chromium error page or "Loading chunk failed".
- Still offline, open a screen you have never visited on this build — confirm it
  shows the in-app "You're offline" screen WITH the bottom nav (not a dead-end).
- Disable airplane mode while on that screen — confirm it auto-recovers (reloads
  the screen) without a manual tap.
- Deploy-survival: after the NEXT deploy lands, open the app once online, then go
  offline and repeat the tab sweep — coverage should hold (the previous cache
  generation is retained).
```

- [ ] **Step 2: Commit**

```bash
git add docs/device-smoke-checklist.md
git commit -m "Add offline-shell airplane-mode section to device smoke checklist"
```

---

## Final verification

- [ ] Run the full gate: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`. All green.
- [ ] Re-run the Task 6 Playwright offline repro against the final build; paste the before/after outcome into the PR description.
- [ ] Remove the backlog item 2 entry from `docs/implementation-backlog.md` in the implementing PR (per the backlog protocol), and add the journal + `projectOverview.md` bookkeeping (version bump — this is user-visible, so a minor bump + `lib/changelog.ts` entry).
- [ ] In the PR description, state which surfaces were NOT exercised (per CLAUDE.md): all on-device Samsung-WebView SW behaviour — the airplane-mode smoke (Task 13) is the real merge gate.

## Self-review (done at plan-write time)

- **Spec coverage:** review findings F1 (no fallback → Task 4/3), F2 (deploy wipe → Task 3 retention), F3 (lazy chunks → Task 1/3 precache), F4 (failed nav handling / no indicator → Tasks 8/9), F5 (`res.ok` guard → Task 3), F6 (force-reload → Task 3), F7 (SW health unknown → Task 12); D2 (24h window → Tasks 10/11); D4 (no indicator → Task 8). D1 explicitly deferred. D3 owned by other backlog items (out of scope, noted).
- **Placeholder scan:** every code step contains full source; no TODO/TBD.
- **Type/name consistency:** `listStaticAssets`/`buildPrecacheList`/`renderServiceWorker`/`EXTRA_PRECACHE_URLS` (Task 1) match their uses in Task 2's route; `floorSeedTtl`/`OFFLINE_SEED_TTL_FLOOR` (Task 10) match Task 11's import; `useOnlineStatus` (Task 7) matches Tasks 8; `OfflineIndicator`, `OfflineActions`, `ServiceWorkerStatusRow` component names match their mount sites.

## Sandbox verification map

- **Node-unit-testable (in-sandbox):** the precache-manifest module (Task 1) and the TTL floor (Task 10).
- **Playwright prod-build (in-sandbox, the review's harness):** the SW precache/fallback behaviour (Task 6) and the offline pill (Task 8) — `setOffline` fires DOM events even though it doesn't affect SW fetches, and killing the server simulates true offline for SW fetches.
- **On-device only (merge gate — Task 13):** whether the Samsung WebView keeps the SW registered and persists Cache Storage, real airplane-mode radio behaviour, native `@capacitor/network` events, safe-area rendering of the pill/offline page.

## Risks

- **Precache size:** `.next/static` is O(few MB) for this app and re-downloads once per deploy; acceptable for a single-user app. If it grows, filter `listStaticAssets` to `chunks/`+`css/`+`media/` only.
- **Two-generation retention** roughly doubles static-cache storage (bounded to exactly two builds).
- **First deploy of this change** still wipes the one pre-existing old cache (retention only protects from the *next* deploy onward) — expected, one-time.
- **`skipWaiting` + no force-reload** is safe specifically because the previous generation is retained (Task 3), so an already-open page's old chunks stay resolvable after the new SW takes control.
