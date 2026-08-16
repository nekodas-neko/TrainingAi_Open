# App-Open Oura Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Trigger a throttled background Oura cloud sync when the app opens/foregrounds (mount + native `resume`), so morning sleep/readiness/HR data appears without visiting the Health tab or tapping refresh (finding U5).

**Architecture:** Add ONE fire-and-forget `useEffect` to `components/sync-provider.tsx` that, on mount (all platforms) and on `App.addListener('resume')` (native only), checks the shared `ta_oura_last_sync` throttle against a 6h window and — if stale — `POST`s the existing `/api/oura/sync` route, then invalidates the biometric/Oura caches via the existing `lib/cache-groups.ts` group helpers. The throttle key, window constant, and a pure `shouldSyncOura` predicate are extracted once to `lib/oura/sync-throttle.ts` and reused by BOTH `SyncProvider` and the existing Health-tab auto-sync — the shared key is what prevents the two paths from double-firing. No new sync route or write path is introduced; the existing route (idempotent COALESCE upserts) is reused, so a bad mutation cannot wedge anything.

**Tech Stack:** Next.js 15, React 19, TypeScript, Capacitor (`@capacitor/core`, `@capacitor/app`), vitest.

---

### Task 1: Extract the shared Oura sync throttle (key + window + pure predicate), TDD the predicate

**Files:**
- Create: `lib/oura/sync-throttle.ts`
- Test: `lib/oura/__tests__/sync-throttle.test.ts`

Currently the throttle window (`const SIX_HOURS = 6 * 60 * 60 * 1000`, `app/health/health-content.tsx:476`) and the storage key (`'ta_oura_last_sync'`, literal at `health-content.tsx:449`, `:466`, `:478`) are inline/duplicated. Extract them once so `SyncProvider` and `health-content` share a single definition (one-formula-one-place). The predicate matches the existing Health-tab semantics exactly: it syncs when the elapsed time is **>= the window** (health-content does `if (Date.now() - last < SIX_HOURS) return`, i.e. fires at exactly 6h). Boundary test at exactly 6h must assert `true`.

- [ ] Write `lib/oura/__tests__/sync-throttle.test.ts` with the failing tests:
```ts
import { describe, it, expect } from 'vitest';
import { shouldSyncOura, OURA_SYNC_THROTTLE_MS, OURA_LAST_SYNC_KEY } from '../sync-throttle';

const HOUR = 60 * 60 * 1000;

describe('shouldSyncOura', () => {
  it('exposes a 6h window and the canonical storage key', () => {
    expect(OURA_SYNC_THROTTLE_MS).toBe(6 * HOUR);
    expect(OURA_LAST_SYNC_KEY).toBe('ta_oura_last_sync');
  });

  it('syncs when never synced before (lastSyncMs = 0)', () => {
    expect(shouldSyncOura(0, 12 * HOUR, OURA_SYNC_THROTTLE_MS)).toBe(true);
  });

  it('does NOT sync just under the window (5h59m elapsed)', () => {
    const now = 100 * HOUR;
    const last = now - (6 * HOUR - 60_000); // 1 min short of 6h
    expect(shouldSyncOura(last, now, OURA_SYNC_THROTTLE_MS)).toBe(false);
  });

  it('syncs at exactly the window boundary (6h elapsed)', () => {
    const now = 100 * HOUR;
    const last = now - 6 * HOUR; // exactly 6h
    expect(shouldSyncOura(last, now, OURA_SYNC_THROTTLE_MS)).toBe(true);
  });

  it('syncs past the window (7h elapsed)', () => {
    const now = 100 * HOUR;
    const last = now - 7 * HOUR;
    expect(shouldSyncOura(last, now, OURA_SYNC_THROTTLE_MS)).toBe(true);
  });

  it('defaults windowMs to OURA_SYNC_THROTTLE_MS when omitted', () => {
    const now = 100 * HOUR;
    expect(shouldSyncOura(now - 6 * HOUR, now)).toBe(true);
    expect(shouldSyncOura(now - 5 * HOUR, now)).toBe(false);
  });
});
```

- [ ] Create `lib/oura/sync-throttle.ts` with the complete implementation:
```ts
// Single source of truth for the app-open / Health-tab Oura auto-sync throttle.
// Both components/sync-provider.tsx (mount + native resume) and
// app/health/health-content.tsx (Health-tab open) read this key and window, so a
// sync fired by one path suppresses the other for the throttle period — they can
// never double-fire under normal navigation.
export const OURA_LAST_SYNC_KEY = 'ta_oura_last_sync';
export const OURA_SYNC_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * True when a background Oura sync is due — elapsed time is at or past the window.
 * `>=` matches the existing Health-tab semantics (fires at exactly the boundary).
 */
export function shouldSyncOura(
  lastSyncMs: number,
  nowMs: number,
  windowMs: number = OURA_SYNC_THROTTLE_MS,
): boolean {
  return nowMs - lastSyncMs >= windowMs;
}
```

- [ ] Run `pnpm test lib/oura/__tests__/sync-throttle.test.ts` — all cases pass.

---

### Task 2: Point the existing Health-tab auto-sync at the shared throttle (kill the duplicate constant/key)

**Files:**
- Modify: `app/health/health-content.tsx:449`, `:466`, `:473-482`

This is the one-formula-one-place cleanup: replace the inline `SIX_HOURS` literal and the three `'ta_oura_last_sync'` string literals with the shared module, and use `shouldSyncOura` for the window check. Behaviour is unchanged — this only removes the duplication so the new `SyncProvider` effect and this effect share a single definition. Do not touch any other logic in this file.

- [ ] Add the import alongside the existing `lib/cache-ttl` import (after `health-content.tsx:29`):
```ts
import { OURA_LAST_SYNC_KEY, shouldSyncOura } from '@/lib/oura/sync-throttle';
```

- [ ] Replace the `handleSyncOura` timestamp write (`health-content.tsx:449`):
```ts
        try { localStorage.setItem(OURA_LAST_SYNC_KEY, String(Date.now())) } catch { /* ignore */ }
```

- [ ] Replace the `handlePullSync` timestamp write (`health-content.tsx:466`):
```ts
    try { localStorage.setItem(OURA_LAST_SYNC_KEY, String(Date.now())) } catch { /* ignore */ }
```

- [ ] Replace the entire auto-sync effect (`health-content.tsx:473-482`) with the shared-predicate version:
```ts
  // Auto-sync Oura data when Health page opens, if last sync was >6 hours ago.
  // Runs silently in the background — re-fetches body/sleep caches when done.
  // Shares the throttle key/window with SyncProvider's app-open sync so the two
  // never double-fire under normal navigation.
  useEffect(() => {
    let last = 0
    try { last = Number(localStorage.getItem(OURA_LAST_SYNC_KEY) ?? 0) } catch { return }
    if (!shouldSyncOura(last, Date.now())) return
    handleSyncOura()
  }, [handleSyncOura])
```

- [ ] Run `pnpm tsc --noEmit` — no new type errors from this file.

---

### Task 3: Add the throttled app-open Oura sync effect to `SyncProvider`

**Files:**
- Modify: `components/sync-provider.tsx` (imports at `:11-16`; new effect after the network-drain effect at `:154`)

`SyncProvider` already: (a) does `pushMutations`/`pullDelta` on mount and maps synced domains to cache-group invalidations at `:107-124` (PR #213 extended this `SyncedDomains` mapping — `delta.domains.ouraDaily → invalidateOuraSync()` at `:118`); and (b) uses the native-gated mount+`resume` pattern in three reminder-reconcile effects (`:157-189`, `:192-221`, `:224-249`). This new effect mirrors that mount+`resume` shape but is NOT fully native-gated: the **mount** sync runs on every platform (web PWA included, like the Health-tab sync does), while only the **resume listener** is added on native (`resume` fires only on native anyway).

Why this doesn't duplicate `pullDelta`'s Oura handling: `pullDelta` only mirrors Oura data the **server already has** into the device; it never reaches the Oura cloud. This effect is the only app-open path that pulls fresh data from Oura into the server.

Fire-and-forget: the effect body calls `maybeSyncOura()` without awaiting and returns synchronously, so first paint is never blocked. Cache invalidation uses the existing `invalidateOuraSync()` + `invalidateBiometrics()` group helpers from `lib/cache-groups.ts` — never an ad-hoc key list. The route is the existing `/api/oura/sync` (body `{ daysBack: 7 }`, matching both Health-tab sync sites) — no second sync path is created, so nothing new can wedge the outbox.

**Double-fire safety (call-out):** the shared `OURA_LAST_SYNC_KEY`/window means that after this effect syncs on mount and stamps the key, navigating to the Health tab finds the key fresh (<6h) and skips — and vice-versa. The two paths cannot double-fire under normal navigation. (The one residual edge — cold-opening *directly onto* `/health`, where both effects read the stale key on the same tick before either writes it — results in at most one redundant POST; the route's COALESCE upserts are idempotent, so it is harmless. Not mitigated, to avoid diverging the two paths' write-after-success semantics.)

- [ ] Extend the `lib/cache-groups` import (`sync-provider.tsx:12-15`) to ensure `invalidateBiometrics` and `invalidateOuraSync` are imported (both already are — confirm, no edit needed if present).

- [ ] Add the shared-throttle import after `sync-provider.tsx:16`:
```ts
import { OURA_LAST_SYNC_KEY, shouldSyncOura } from '@/lib/oura/sync-throttle';
```

- [ ] Insert the new effect immediately after the network-drain effect (after `sync-provider.tsx:154`, before the meal-reminder effect):
```ts
  // Throttled background Oura cloud sync on app open + native resume. Mirrors the
  // Health-tab auto-sync (app/health/health-content.tsx) and shares its throttle
  // key/window (lib/oura/sync-throttle.ts) so the two never double-fire. Unlike
  // pullDelta above (which only mirrors server data to the device), this reaches
  // the Oura cloud — it's the only app-open path that pulls fresh sleep/readiness.
  // Fire-and-forget: never blocks first paint. Mount runs on all platforms; the
  // resume listener is native-only (resume only fires on native).
  useEffect(() => {
    let cancelled = false;
    let handle: { remove: () => void } | undefined;

    async function maybeSyncOura() {
      let last = 0;
      try { last = Number(localStorage.getItem(OURA_LAST_SYNC_KEY) ?? 0); } catch { return; }
      if (!shouldSyncOura(last, Date.now())) return;
      try {
        const res = await fetch('/api/oura/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ daysBack: 7 }),
        });
        if (!res.ok) return; // not connected / expired token — retry next open
        const data = await res.json();
        if (!data?.success) return;
        try { localStorage.setItem(OURA_LAST_SYNC_KEY, String(Date.now())); } catch { /* ignore */ }
        await invalidateOuraSync();
        await invalidateBiometrics();
      } catch {
        // Network unavailable — skip, will retry on next open/resume
      }
    }

    // Fire on mount (all platforms), fire-and-forget.
    maybeSyncOura();

    // Add the resume listener on native only (resume never fires on web/PWA).
    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { App } = await import('@capacitor/app');
      const h = await App.addListener('resume', maybeSyncOura);
      if (cancelled) { h.remove(); return; }
      handle = h;
    })();

    return () => { cancelled = true; handle?.remove(); };
  }, []);
```

- [ ] Run `pnpm tsc --noEmit`, `pnpm lint` — clean.

---

### Task 4: Verify the provider wiring end-to-end (effect-only → drive it, don't just typecheck)

**Files:** none (verification only)

The provider wiring is UI/effect-only, so tests won't exercise it — drive the real POST behaviour against the local dev server. Native `resume` and a real Oura token are NOT exercisable in the sandbox (see caveat below); the mount branch and throttle are.

- [ ] Start the local dev server: `pnpm dev` (uses the local seeded Postgres per CLAUDE.md; the seed user has no Oura token, so `/api/oura/sync` returns 400 — that's the expected not-connected branch and must NOT stamp the key).
- [ ] Clear the throttle: in the browser devtools console run `localStorage.removeItem('ta_oura_last_sync')`, then hard-reload the app root (Home). In the Network tab, confirm exactly one `POST /api/oura/sync` fires on cold open (fire-and-forget; page paints immediately — no blocking spinner). With the seed user it returns 400 and the key stays unset (verify `localStorage.getItem('ta_oura_last_sync')` is null) so a connected user would retry next open.
- [ ] Throttle skip: set `localStorage.setItem('ta_oura_last_sync', String(Date.now()))`, reload — confirm NO `POST /api/oura/sync` fires (within-window skip). Then set it to 7h ago (`String(Date.now() - 7*60*60*1000)`), reload — confirm the POST fires again.
- [ ] No double-fire under navigation: with the key freshly stamped (<6h), navigate to the Health tab and confirm health-content's auto-sync does NOT fire a second `POST /api/oura/sync` (shared key skip).
- [ ] Optional (Playwright): a `page.route('**/api/oura/sync')` interceptor asserting one request on cold open with cleared key, zero on reload with a fresh key.

---

### Task 5: Acceptance criteria + caveats

**Files:** none

- [ ] Confirm acceptance criteria for backlog entry #12 / U5 (`docs/reviews/2026-07-04-user-review-round-2.md` §"Acceptance criteria", #13):
  - Cold-open after >6h → sleep/readiness data appears **without** visiting Health or tapping refresh (verify on APK with a real token).
  - The sync is throttled: a second open within 6h does not re-POST.
  - No double-fire with the Health-tab sync (shared `ta_oura_last_sync` key/window — Task 3 call-out).
  - Cache freshness: after the sync, `invalidateOuraSync()` + `invalidateBiometrics()` clear the biometric/Oura caches so Home/Health repaint with the new data on next read (no ad-hoc key lists; group helpers only).
  - Full suite green: `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build`.
- [ ] ⚠️ **Sandbox-unexercisable surfaces (state these when presenting the work):**
  - **Native `resume`** — `App.addListener('resume', …)` only fires on the APK; the sandbox/web path returns early at `Capacitor.isNativePlatform()`. The resume-triggered sync is verifiable only on the S25.
  - **Real Oura token / real data landing** — the local seed user has no Oura PAT, so `/api/oura/sync` returns the 400 not-connected branch; that a non-null sleep/readiness row actually lands in the DB after a real morning sync is only provable on-device with the user's connected ring.
  - Run `docs/device-smoke-checklist.md` for the on-device confirmation of both.
