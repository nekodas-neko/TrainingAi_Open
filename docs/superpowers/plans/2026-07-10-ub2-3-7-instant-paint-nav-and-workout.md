# Perceived Latency — Instant-Paint Navigation + Workout Reopen/Finish Repaint

**Source:** `docs/reviews/2026-07-09-user-reported-bugs.md` (UB2, UB3, UB7). Grounded against
`main` @ `6264f16` (current HEAD). **Branch:** `perf/instant-paint-nav-workout`. Server/JS +
client only — ships via Railway into the WebView, **no APK rebuild**. **But** perceived
latency and the workout-store paint are only truly measurable on the APK/Samsung WebView:
`pnpm dev` + `docs/device-smoke-checklist.md` are the gates. The web sandbox **cannot**
reproduce two surfaces this plan touches — the native View-Transition timing on Samsung's
WebView compositor, and the local-SQLite path (`getLocalStore` returns `null` on web, so any
local-first done-state hydration in Chunk B is **device-verify only**). Chunk B's *primary*
fix, however, rides on the persisted Zustand store (`localStorage`), which **does** work on
web — so the core reopen-flash fix is dev-server-verifiable; only the optional SQLite
hydration is not.

**Goal:** make bottom-nav tab switches paint the cache-seeded next screen on the next frame
instead of behind a View-Transition animation, and make opening/finishing a workout paint
already-completed exercises immediately from local state instead of waiting on a 6-hour-TTL
server flag.

**Governing CLAUDE.md rules:** *Mobile UI & Performance → Instant paint* ("a skeleton flash
on a repeat visit is a bug"; "Saves feel instant — the UI never waits for the network"),
*Offline-First → local store is the source of truth*, *Render discipline → memo only works
with stable props*, *Zustand Persisted Store → daily state keyed by (local date, session
id)*, *Mutation-callback contract*.

The two chunks are independent and independently shippable (two PRs is fine). Chunk A is the
headline "reactiveness" item; Chunk B is the workout-repaint cousin.

---

## Chunk A — Navigation instant-paint (UB2 / UB3)

Two compounding costs on every bottom-nav tap and edge-swipe. Task A1 removes the animation
gate; Task A2 removes a per-tab DB round-trip.

### Why the View Transition is pure latency here

`components/shell/bottom-nav.tsx:47` and `components/shell/tab-swipe-navigator.tsx:30` both
route through `navigateWithTransition` (`lib/navigate-with-transition.ts:29`):

```ts
(document as Document & { startViewTransition(cb: () => void): void }).startViewTransition(() => router.push(href));
```

`startViewTransition` snapshots the **old** DOM, runs the callback, then snapshots the
**new** DOM and animates old→new. But `router.push` kicks off an **async RSC navigation** —
the new screen's DOM is *not* present when the "after" snapshot is captured, so the API
animates the outgoing screen (`vt-fade-out 0.18s`, `globals.css:432-433`) / a
directional slide of near-identical content (`vt-slide-in-* 0.22s`, `globals.css:435-440`)
while the real next screen is still resolving. Net effect: **~0.2 s of animating stale
content gates the cache-seeded instant paint** the screens already build (e.g.
`session-select-content.tsx:200-348` seeds synchronously from `readCacheSync`/
`readTodayCacheSync` in a `useLayoutEffect`). On the app's highest-frequency interaction, the
slide's polish is not worth the per-tap delay — this is a direct *Instant paint* violation.

You cannot keep both a meaningful directional slide **and** an ungated push with this API:
firing `router.push` *before* `startViewTransition` makes the old and new snapshots identical
(no animation), and firing it *inside* is exactly today's gate. So the recommendation is to
**drop the transition for tab navigation** and push immediately.

### Task A1 — Push immediately for tab-to-tab navigation; drop the View-Transition wrapper

Both call sites of `navigateWithTransition` are tab-to-tab (bottom-nav taps, edge-swipe), so
collapse the helper to a direct push. Keep the function + signature so the two call sites and
their haptics/guards don't churn.

`lib/navigate-with-transition.ts` — replace the whole body:

```ts
import type { useRouter } from "next/navigation";

type Router = ReturnType<typeof useRouter>;

/**
 * Navigate between the 5 main tabs. Deliberately a plain `router.push` with no
 * `document.startViewTransition` wrapper: tab screens seed synchronously from cache
 * (readCacheSync/readTodayCacheSync in a useLayoutEffect) and paint on the next frame,
 * so the directional View-Transition slide only animated stale content while gating that
 * instant paint by ~0.2s — pure perceived latency on the app's most frequent interaction
 * (UB2/UB3). The `fromPathname` arg is retained for call-site compatibility.
 */
export function navigateWithTransition(router: Router, _fromPathname: string, href: string): void {
  router.push(href);
}
```

- The `data-nav-direction` dataset writes go away; the `::view-transition-*` rules in
  `globals.css:428-440` become dead (no transition ever starts) — **delete those keyframes +
  selectors in the same PR** (and the `::view-transition-old/new(root)` reset at
  `globals.css:464`) so no orphaned CSS lingers. Leave the unrelated `.content-fade-in`
  keyframe (`globals.css:442+`) and `prefers-reduced-motion` block intact.
- `bottom-nav.tsx:47` and `:121`, and `tab-swipe-navigator.tsx:30` keep calling
  `navigateWithTransition(...)` unchanged — the `hapticLight()`/workout-guard logic in
  `handleNavClick` (`bottom-nav.tsx:38-48`) is untouched.
- `activeTabIndex` import in `navigate-with-transition.ts` is now unused — remove it.

**Optional polish (only if the abrupt cut feels bare on device):** add `.content-fade-in`
(already defined) to each tab screen's outermost content container so the seeded screen
fades in over ~120 ms *without* gating navigation. Do **not** reintroduce `startViewTransition`.

**Verify:** `pnpm dev` — tapping between Home/Workout/Health/More paints the next screen with
no slide and no skeleton flash (screens already cache-seed). On device (S25 APK): tab taps
and edge-swipes feel immediate; confirm the edge-swipe still commits at `COMMIT_PX`
(`tab-swipe-navigator.tsx:10`) and no longer waits on an animation. This is the surface the
web sandbox can't fully judge — run `docs/device-smoke-checklist.md`.

### Task A2 — Collapse the `/health` double auth+DB lookup to a single session read

`app/health/page.tsx:8-15` is the only tab page doing an **extra DB round-trip** on top of
`auth()`:

```ts
const session = await auth();
if (!session?.user?.id) redirect("/sign-in");
const repo = await getRepository();
const dbUser = await repo.getUserByEmail(session.user.email!);   // ← per-tab DB call on the critical path
```

That `getUserByEmail` fetches `sex`, `heightCm`, `dateOfBirth`, `activityLevel`. **Three of
the four are already in the JWT** — `auth.config.ts:38-40` puts `sex`/`heightCm`/`dateOfBirth`
on the token and `:54-56` onto `session.user` (and `auth.ts:40-42,84-86` seed them at
sign-in). Only `activityLevel` is missing. So:

1. **Add `activityLevel` to the JWT** (mirror the existing three), so the page needs no DB
   call:
   - `auth.ts` — add `activityLevel: user.activityLevel ?? null` to both the credentials
     `authorize` return (`:40-42` block) and the two `signIn` seed blocks (`:66-68`, `:84-86`).
   - `auth.config.ts:40` — add `if ('activityLevel' in (user ?? {})) token.activityLevel = (user as any).activityLevel ?? null`.
   - `auth.config.ts:56` — add `session.user.activityLevel = token.activityLevel ?? null`.
   - Add `activityLevel` to the next-auth module augmentation (wherever `sex`/`heightCm` are
     declared on `Session["user"]` / the JWT — grep `heightCm` in `types/next-auth.d.ts` or
     the inline `declare module` block and add the sibling field).
2. **`app/health/page.tsx`** — drop `getRepository()`/`getUserByEmail` and read from session:

```ts
export default async function HealthPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  return (
    <>
      <Suspense fallback={null}>
        <HealthContent
          userId={session.user.id}
          sex={session.user.sex ?? null}
          heightCm={session.user.heightCm ?? null}
          dateOfBirth={session.user.dateOfBirth ?? null}
          activityLevel={session.user.activityLevel ?? null}
        />
      </Suspense>
      <BottomNav isAdmin={session.user.isAdmin} />
    </>
  );
}
```

This matches how `/` (`app/page.tsx:7-16`) and `/workout` (`app/workout/page.tsx:15-16`)
already trust the JWT (`isAdmin`, `id`) with no DB call. The original comment ("JWT may be
stale if profile was updated since last login") is acceptable to drop: the other tabs already
trust the JWT for `timezone`/`isAdmin`, `HealthContent` re-reads live profile-derived values
client-side from its own cached endpoints, and a profile edit re-issues the JWT on next
session refresh — consistent with the *Canonical Runtime* pass-through-only policy.

> **Scope note (do not expand):** every tab's `await auth()` decodes the JWT cookie (no DB)
> but still marks the route dynamic, so `<Link prefetch>` (`bottom-nav.tsx:69,94`) can only
> warm the shell, not the full dynamic RSC payload — a residual per-tap server render remains.
> Removing `auth()` from the pages in favour of trusting middleware (`middleware.ts:9-25`
> already redirects unauthenticated requests) is a larger, riskier change (pages still need
> `session.user.id`/`isAdmin`); **leave it out of this PR** and note it as a follow-up if the
> device still feels slow after A1+A2.

**Verify:** `pnpm dev` — sign in, open `/health`; profile-derived cards (BMI, energy balance)
render with correct sex/height/age/activity, proving the JWT carries all four. Type-check
passes with the augmentation. Confirm a fresh login (re-issued JWT) and a credentials login
both populate `activityLevel` (log it once, or check `useEnergyBalance` output). Network tab:
no `getUserByEmail` query fires on a `/health` navigation.

---

## Chunk B — Workout reopen/finish local-first repaint (UB7)

`PreWorkoutScreen` marks an exercise done via
`todayLogged.has(ex.name) || ex.loggedTodayInSession` (`pre-workout-screen.tsx:113,207`).
Both inputs lag on a fresh mount. The fix keeps done-state on the **persisted, optimistic**
`todayLogged` Zustand set (which already survives reopen in `localStorage`) and removes the
two things that blank it.

### Finding correction (vs the review)

The review (UB7) states finishing lags because *"the reset effect wipes the client Set
(`workout-screen.tsx:324-330` → `resetSession()` clears `todayLogged`)."* **That is
inaccurate at current code:** `resetSession` (`lib/stores/workout-store.ts:206-212`)
explicitly *preserves* it — `todayLogged: s.todayLogged`. So finishing does **not** clear
completions. The real finish-lag cause is the *same* as the open-lag cause: on remount,
`programSessionId` (component `useState`, not persisted) resets to `undefined`, so the
read key falls back to the session-name and misses the completions written under the real
session id. Both open and finish are one bug: **the undefined-`programSessionId` key
window.** A *second*, separate blanking bug does exist — `refreshExercises` calling
`clearTodayLogged()` — addressed in Task B2.

### The key-window mechanism

- **Write:** `workout-screen.tsx:859` — `store.addTodayLogged(programSessionId ?? sessionType.toLowerCase(), ex.name)`.
  At log time the workout data is loaded, so the key is the real `programSessionId` (a UUID).
- **Read:** `workout-screen.tsx:1075-1077`:

```ts
const todayLoggedKey = programSessionId ?? sessionType.toLowerCase();
const todayLoggedSet = useMemo(
  () => new Set(store.todayLogged[todayLoggedKey] ?? []),
  [store.todayLogged, todayLoggedKey],
);
```

`programSessionId` starts `undefined` on every mount and is only set once
`fetchExercises` runs (in a `useEffect`, i.e. *after* the first paint —
`workout-screen.tsx:222/229/247/267/286`). So the first painted frame keys by
`sessionType.toLowerCase()`; if the workout was addressed by name (not id), that misses the
UUID bucket and the green ticks flash absent for ~1 s until the fetch flips the key. (When
`sessionType` is already the session id the fallback happens to match, so the flash is
name-addressing-specific — but the fix below is robust either way.)

### Task B1 — Seed `programSessionId` synchronously before first paint

`fetchExercises` already reads the seed synchronously (`readCacheSync` at
`workout-screen.tsx:210/216`) and calls `setProgramSessionId(seed.session.id)` — but from a
`useEffect`, which runs *after* paint. Hoist **only** the id resolution into a
`useLayoutEffect` so the key is correct on the first painted frame. This mirrors
`session-select-content.tsx:200-348` (its instant-paint seed is a `useLayoutEffect`) and
satisfies *Instant paint* ("Seed in a `useEffect`/layout effect, **never** a `useState` lazy
initializer").

Add near the other mount effects in `workout-screen.tsx` (before the `fetchExercises`
effect at `:286`):

```ts
// Resolve the program session id synchronously (before paint) from the same cache seed
// fetchExercises reads, so todayLoggedKey matches the id completions were written under —
// otherwise the first painted frame keys by the session-name fallback and prior
// completions flash unmarked on every open/finish (UB7). Cheap: one sessionStorage read.
useLayoutEffect(() => {
  if (programSessionId) return;
  const tab = sessionType.toLowerCase();
  const cacheKey = `workout-data:${tab}${aiDeload ? ':deload' : ''}`;
  const seed =
    readCacheSync<{ session?: { id: string } }>(cacheKey) ??
    (!aiDeload ? readCacheSync<{ session?: { id: string } }>(`workout-card:${sessionType}`) : null);
  if (seed?.session?.id) setProgramSessionId(seed.session.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [sessionType, aiDeload]);
```

- Use `useLayoutEffect` (add to the React import if absent). It runs before the browser
  paints, so `todayLoggedKey` is the UUID on frame 1 whenever a seed exists — which is every
  reopen after the first (the warm-cache case UB7 describes). Cold first-ever open has no
  seed *and* no prior completions, so the fallback key is harmless there.
- The redundant `setProgramSessionId` calls already in `fetchExercises` stay (idempotent).
- This is a leaf-cheap, ref-free read; it does **not** violate the "no `readCacheSync` in a
  render body that ticks on a timer" rule — it's in an effect keyed by identity, not the
  render body.

**Verify:** `pnpm dev` — start a workout, log 2 exercises, back out to the session hub, leave
to Home, return to the workout: the two exercises show their green check + `bg-green-500/10`
card immediately on first paint (no ~1 s unmarked flash). Repeat addressing the session by
name vs by id (both `?session=` forms) — no flash either way. Complete a workout to the done
screen, navigate away and back: completed exercises paint immediately.

### Task B2 — Stop `refreshExercises` from blanking same-day completions

`refreshExercises` (`workout-screen.tsx:278-284`) calls `store.clearTodayLogged()`:

```ts
const refreshExercises = useCallback(() => {
  const tab = sessionType.toLowerCase();
  invalidateCache(`workout-data:${tab}${aiDeload ? ':deload' : ''}`).catch(() => {});
  store.clearTodayLogged();          // ← wipes ALL sessions' optimistic completions
  fetchExercises();
}, [sessionType, fetchExercises]);
```

`clearTodayLogged()` empties the whole `todayLogged` record (`workout-store.ts:300`), then
done-state falls back entirely to the 6h-TTL `loggedTodayInSession` server flag until the
revalidating fetch lands — the exact *Instant paint* violation. Crucially this fires on more
than the manual refresh button: `onPrescriptionStatusChange` (`workout-screen.tsx:1114`) and
`onPhaseChanged` (`:1127`) both call `refreshExercises`, so **accepting/dismissing an AI
prescription or advancing a phase blanks every green tick**. `todayLogged` is the optimistic
local record of what the user logged today (persisted, date-keyed) — a data refetch must not
discard it.

**Remove the `store.clearTodayLogged()` line from `refreshExercises`.** The refetch still
re-derives `loggedTodayInSession` from the server, and `todayLogged` continues to reflect
this session's optimistic completions — the two OR together correctly
(`pre-workout-screen.tsx:207`). Nothing in a program/prescription/phase refresh changes what
was logged *today*, so there is no stale-tick scenario clearing was protecting against. (Date
rollover is already handled by `onRehydrateStorage`, `workout-store.ts:311-318`.)

> `clearTodayLogged` remains defined; after this change it has no caller. Either delete the
> action from the store (and its interface entry, `workout-store.ts:117`) in the same PR, or
> leave it if a future explicit "hard reset" wants it — prefer deleting to avoid a dead
> mutator. Confirm no other caller with a grep before deleting.

**Verify:** `pnpm dev` (ai_dynamic program) — log an exercise, then accept the AI prescription
card: the logged exercise stays checked (previously it blanked). Tap the header refresh button
(`pre-workout-screen.tsx:152`): completions persist. Advance a phase: completions persist.

### Task B3 — (Optional, deferred, device-verify) Local-SQLite done-state hydration

B1+B2 fully fix the reported case (reopen/finish *within the same day on the same device*),
because `todayLogged` persists in `localStorage`. The only residual gap is a device whose
`localStorage` `todayLogged` is empty but whose local SQLite (or the server) holds today's
logs — e.g. cleared app data or a second device. Covering it means hydrating `todayLogged`
from the local store on mount:

- On mount, read `getLocalStore(userId)` → today's `workout_sessions` (via
  `getWorkoutSessions(cutoff)`, `sqlite-backend.ts:79`) → their `exercise_logs`
  (`:96`), and seed `store.addTodayLogged(<key>, exerciseName)` for each. Note the local
  `workout_sessions` row carries `sessionName`, **not** the program session id
  (`sqlite-backend.ts:84-93`), so matching to "this program session" must be by display
  name — accept that the shared-exercise-across-sessions dedup is coarser locally, or add a
  `program_session_id` column to the local table (a schema migration + `RECONCILE_*`
  registration per the *Local SQLite Migrations* rules — larger scope).

**This is explicitly out of scope for the primary PR.** It is device-only-verifiable
(`getLocalStore` is `null` on web) and addresses an edge case the user did not report. If
built, it ships as its own follow-up with an on-device smoke run; otherwise note it in
`projectOverview.md` as a known limitation. Recommend **defer**.

**Verify (if built):** on device, clear app storage, ensure a workout is in local SQLite,
open it → completions paint from the local store with no server round-trip.

---

## Sequencing & PR split

- **PR 1 (Chunk A):** `navigate-with-transition.ts` + `globals.css` cleanup (A1), `/health`
  JWT collapse (A2). Web + device smoke. Low risk, high perceived-latency payoff.
- **PR 2 (Chunk B):** B1 (layout-effect key seed) + B2 (drop `clearTodayLogged`). Web-
  verifiable via `localStorage`; device smoke confirms the paint. B3 deferred.

**Chunk A shipped (v1.124.5, 2026-07-10, session 251).** A1: `navigateWithTransition` collapsed
to a plain `router.push`, the `data-nav-direction` dataset writes and the now-dead
`vt-slide-in-*`/`vt-fade-out` keyframes + `::view-transition-*` rules (including the
reduced-motion override) removed from `globals.css`. A2: added `activityLevel` alongside the
existing `sex`/`heightCm`/`dateOfBirth` JWT fields (`auth.ts`'s three seed blocks,
`auth.config.ts`'s `jwt`/`session` callbacks, the `next-auth` module augmentation), and
`/health/page.tsx` now reads all four from `session.user` instead of an extra
`getUserByEmail` DB call. Verified end-to-end on the local dev DB: fresh login carries
`activityLevel` in the session JSON (checked with a seeded `moderately_active` value), `/health`
renders 200, all four tabs (`/`, `/workout`, `/health`, `/more`) render 200. Not exercised: the
View-Transition timing removal and edge-swipe feel are only truly judged on the Samsung WebView —
`docs/device-smoke-checklist.md` is the real gate, not run this session. Chunk B (workout
reopen/finish repaint) is a separate PR, not yet started.

Both are user-visible → bump `package.json` (patch) and add a `lib/changelog.ts` entry in
each PR. Per *Communication*, when presenting: the View-Transition timing (A1) and the
workout-store on-device paint (B1/B2) were **not** exercised on Samsung WebView in-session —
`docs/device-smoke-checklist.md` is the required gate; native SQLite (B3) is unreachable on
web entirely.
