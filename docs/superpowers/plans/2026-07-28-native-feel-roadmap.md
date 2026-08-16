# Native ("Swift-like") Feel — Roadmap and Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TrainingAI feel instant on the S25 — presentation never waits on a network read —
by fixing the one remaining first-paint gap now, and sequencing the two architectural levers
(cold start, non-tab navigation) behind a measurement gate.

**Architecture:** The app already satisfies most of the "native feel" invariants: writes are
local-first via the outbox, the five main tabs are a persistent client shell, and 61 of 72
network-reading components already seed synchronously from cache. What remains is one unseeded
on-load surface, plus two costs no component can work around — the HTML document is a remote
fetch (cold start) and six non-tab routes go through the service worker's network-first path.

**Tech Stack:** Next.js 15 / React 19, Capacitor WebView on a remote Railway URL,
`lib/sqlite/cache.ts` (`cachedFetch` / `readCacheSync`), `lib/local-store/` (on-device SQLite),
`public/sw-template.js` (service worker).

---

## Why this plan starts with measurement, not code

**The configuration that produced the owner's complaint no longer exists.** Between 2026-07-28 and
the time of writing, the app service was in Singapore while the Postgres service was still in
us-east. That is the pathological case the original brief warned about: every query crossed the
Pacific over the private network, so a route like `/api/workout-data` (29 DB operations) paid the
ocean crossing 29 times *sequentially in places*, on top of a request that had already crossed once.

Both services are now in Singapore. **Any optimisation decided from pre-move impressions is
decided from data that no longer describes the system.** Issue #868's own instruction — "measure
before optimising" — applies with full force here.

### Three corrections to the prior investigation

These are recorded so no future session re-derives them. All three were claims that read as
measurements but were not:

1. **The 172 ms public-proxy finding never applied to the app.** Source-verified: only two pools
   exist. `lib/data/postgres/client.ts` reads `DATABASE_URL` (internal, 59 call sites — the whole
   app); `lib/data/postgres/readonly-client.ts` reads `CLAUDE_DB_READONLY_URL` (the public proxy)
   and serves `/api/admin/db-query` alone. The 172 ms was measured against the admin audit
   endpoint. **The "one env-var fix" hypothesis is dead.**
2. **"Every screen change waits for a network round trip" is too broad.**
   `components/shell/tab-shell.tsx` keeps the five main tabs mounted as a persistent client shell
   and switches via `window.history.replaceState`. Tab flips never reach the service worker's
   navigation path. The critique applies only to cold start and non-tab routes.
3. **Cache-seed coverage is 85%, not 60%.** An earlier count grepped only `readCacheSync` and
   missed `readTodayCacheSync` — a different function used by many seeded components. Corrected:
   61 of 72 `cachedFetch` consumers seed synchronously.

### One measurement attempted and discarded

Timing the home-tab endpoints against `pnpm dev` produced 289–474 ms per endpoint. `/api/auth/csrf`,
which touches no database, also took 289 ms; a static manifest took 681 ms. **That floor is
Next.js dev-mode overhead and says nothing about production** (a production build measured a 7 ms
floor on the same route). Per-endpoint *production* compute was not successfully measured in the
sandbox — `pnpm start` forces `NODE_ENV=production`, which switches the pool to SSL that the local
Postgres socket cannot serve. **Server-side compute per endpoint remains unmeasured.**

---

## Phase 0 — Re-measure from the device (GATE, no code)

**Owner-run. Nothing below Phase 1 should be built until this produces numbers.** A sandboxed
agent is not in Australia and cannot measure Brisbane→Singapore latency.

- [ ] **Step 1: Connect the S25 and open DevTools against the APK WebView**

Plug the S25 in with USB debugging on, then open `chrome://inspect/#devices` on the desktop and
click **inspect** under the TrainingAI WebView.

- [ ] **Step 2: Capture a cold open**

In the Network tab, tick **Disable cache** OFF (we want real SW behaviour). Force-stop the app on
the phone, then launch it. Record from the Network panel:

| Measure | Where to read it |
|---|---|
| DNS + TLS | Timing tab of the first document request |
| Document TTFB | `Waiting (TTFB)` on the document row |
| RSC payload | the `?_rsc=` request(s) |
| Each `/api/*` call | filter `/api/`, note count and slowest |
| First meaningful paint | Performance panel, or the first frame showing content |

- [ ] **Step 3: Capture a warm screen change**

With the app already open, switch to a **non-tab** route (`/workout`, `/config`, `/history`,
`/stats`, `/profile`, `/chat`) and record the same rows. Then switch between two **tabs** and
confirm — as predicted by the tab-shell finding — that no document request occurs.

- [ ] **Step 4: Write the numbers into this file under "Phase 0 results"**

State plainly which of the three costs dominates: **geography** (TTFB high, compute low),
**server compute** (TTFB high but the server is near), or **round-trip count** (each call fast,
but there are ~15 of them).

**Decision rule for what to build next:**

| If Phase 0 shows | Then the next plan is |
|---|---|
| Cold start dominates; warm tabs already instant | Phase 3 (shell bundling) |
| Non-tab navigation is the slow part | Phase 2 (SW navigation SWR) |
| Individual `/api/*` calls are slow despite low RTT | a server-compute plan (profile the heavy routes) |
| Many fast calls, high total | Phase 4 (collapse the home burst) |

---

## Phase 1 — The one first-paint gap (build now, independent of Phase 0)

Only one unseeded surface is visible on load. `components/shell/bottom-nav.tsx` is also unseeded
but fetches `admin-pending-count`, a badge — not content — so it is deliberately left alone. The
remaining nine unseeded files are on-demand sheets and dialogs where a brief load is acceptable.

### Task 1: Seed `home-day-timeline` from cache on first paint

`components/home-day-timeline.tsx:209` calls `cachedFetchToday` with **no synchronous seed**, so
the home screen's timeline renders empty on every visit until the network answers. Every sibling
home widget seeds. This is the "skeleton flash on a repeat visit is a bug" rule in `CLAUDE.md`.

Note `CLAUDE.md` sanctions this component reading *server-only* (it is a cross-domain aggregate,
not a single-domain read). **That exemption is about not building a client-side timeline
assembler — it does not exempt it from seeding its own cache key.** Seeding changes nothing about
where the data comes from; it only paints the last-known value first.

**Files:**
- Modify: `components/home-day-timeline.tsx` (import + the effect at ~line 209)

- [ ] **Step 1: Read the current fetch effect**

Run: `sed -n '200,225p' components/home-day-timeline.tsx`
Expected: a `useEffect` calling `cachedFetchToday<{ events: TimelineEvent[] }>` with the key
used at line 210, and a `useState` for the events list initialised to empty.

- [ ] **Step 2: Add the synchronous seed**

Change the import on line 9 to bring in the today-variant reader alongside the fetcher:

```tsx
import { cachedFetchToday, readTodayCacheSync } from "@/lib/sqlite/cache";
```

Then, inside the **same `useEffect` that performs the fetch** and *before* the `cachedFetchToday`
call, seed from cache. Use the exact same cache key string already passed to `cachedFetchToday`:

```tsx
const seeded = readTodayCacheSync<{ events: TimelineEvent[] }>("home-day-timeline");
if (seeded?.events?.length) setEvents(seeded.events);
```

Two constraints from `CLAUDE.md`, both load-bearing:
- The seed goes in a `useEffect`, **never** a `useState` lazy initializer — cache reads in
  initializers caused React hydration mismatches (session 165).
- Use `readTodayCacheSync`, not `readCacheSync`, because the paired fetcher is `cachedFetchToday`.
  Mixing the variants for one key is the "one fetch variant per key" violation.

- [ ] **Step 3: Verify the key matches exactly**

Run: `grep -n '"home-day-timeline"' components/home-day-timeline.tsx`
Expected: **two** hits — the `readTodayCacheSync` seed and the `cachedFetchToday` call — with
byte-identical key strings. A mismatched key seeds nothing and fails silently.

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Exercise it on the local dev server**

Run: `pnpm dev`, sign in as `test@local.dev` / `testpass123`, open the home screen, then navigate
away and back.
Expected: on the **second** visit the timeline paints populated immediately with no empty frame.
Broken outcome: an empty timeline that fills in a beat later — means the key mismatched or the
seed landed outside the effect.

- [ ] **Step 6: Commit**

```bash
git add components/home-day-timeline.tsx
git commit -m "Seed the home timeline from cache so it paints on first frame

Every sibling home widget seeds synchronously; this one fetched cold, so the
timeline was blank on every home visit until the network answered."
```

---

## Phases 2–4 — now planned in full, each in its own document

Per `CLAUDE.md` ("if a spec covers many independent areas, consider splitting it into multiple
smaller plan documents"), each phase has its own plan:

| Phase | Plan | Gate |
|---|---|---|
| 2 — Instant navigation (SW stale-while-revalidate) | [`…-phase-2-instant-navigation.md`](2026-07-28-native-feel-phase-2-instant-navigation.md) | Device verification of the deploy-skew case is a **correctness** gate, not polish |
| 3 — Bundle the shell into the APK | [`…-phase-3-bundled-shell.md`](2026-07-28-native-feel-phase-3-bundled-shell.md) | **Owner sign-off on the auth model** before any code; do not start before Phase 0 |
| 4 — Collapse the home-tab request burst | [`…-phase-4-request-collapse.md`](2026-07-28-native-feel-phase-4-request-collapse.md) | May be unnecessary post-co-location; Phase 0 decides |

**Implementation order: 1 → 2 → 0 → 3/4.** Phase 1 and Phase 2 are both correct regardless of what
Phase 0 measures, so they need not wait for it. Phases 3 and 4 both have real "may not be worth it"
outcomes and must not begin until the device numbers exist.

A finding that reshaped Phase 2, recorded here because it corrects the roadmap above: **non-tab
routes are entered by `router.push` (39 call sites), so they fetch RSC payloads, not documents.**
The service worker's `navigate` branch therefore only fires on cold start and hard reload — fixing
it alone would not have made screen changes faster. Phase 2 addresses both branches.

Costs below are retained for the sequencing rationale.

### Phase 2 — Serve navigations stale-while-revalidate

**What:** `public/sw-template.js:137` makes top-level navigations network-first. Switching to
stale-while-revalidate makes the six non-tab routes paint from cache instantly.

**The documented objection is weaker than it looks.** The concern is Next.js deployment skew — a
cached document referencing a previous build's chunks. But the `activate` handler
(`sw-template.js:18-38`) already retains **two** cache generations (current + `prev`), so a
cached document's chunks still resolve after one deploy, and a genuine build-ID mismatch triggers
Next's own hard reload as a self-heal.

**Cost:** small code change, meaningful verification burden. **Risk:** an occasional extra reload
immediately after a deploy. **Must be verified on-device across a real deploy**, not in the
sandbox — that is the only way to see the skew path.

### Phase 3 — Bundle the app shell into the APK

**What:** stop pointing the WebView at the remote URL (`capacitor.config.ts:9`); ship the shell
on-device so cold start costs nothing and only data crosses the ocean.

**This is the only lever that fixes cold start**, and cold start is the most Swift-unlike moment
in the app. But it is the largest change on this list: `TabPage` calls `auth()` server-side and
redirects, so the auth model has to move client-side, and the service worker is *also* the
push-notification transport and the offline cold-start path (`CLAUDE.md`, Canonical Runtime).

**Cost:** large — a project, not a task. **Do not start it before Phase 0**, because the
tab-shell finding means it buys cold start plus six routes, not "every screen change" as the
original brief implied.

### Phase 4 — Collapse the home-tab request burst

> **Superseded and shipped — this section describes the original premise, which was withdrawn.**
> Phase 0 showed Health at 53–85 requests against Home's 20–28, so Phase 4 was re-scoped from Home
> to Health and delivered as "fetch only the sub-tab being shown" (#897, 51→42 in `pnpm dev`). The
> `/api/home-bootstrap` aggregate below was never built: not fetching data beat batching it. Kept
> for the reasoning; see backlog Q-1 for live status.

**What:** the home tab fires ~15 concurrent `/api/*` requests against a pool of `max: 10`
(`lib/data/postgres/client.ts:19`), so five queue by construction.

**Deliberately last.** With Postgres now co-located, each query costs ~1–5 ms, so the queueing
that mattered when the DB was in America may now be invisible. **Phase 0 decides whether this is
worth anything at all.** Note `idleTimeoutMillis: 30_000` similarly mattered more when a
connection cost 172 ms; co-located, re-establishing one is cheap.

---

## Phase 0 results — measured on the S25, 2026-07-29

Owner ran the measurement against the APK with DevTools over USB, no throttling.

### Warm reload of the app

| Metric | Value |
|---|---|
| **Slowest single request** | **25 ms** |
| Total requests | 165 (85 fetch/XHR) |
| Transferred | 1,076 kB |
| DOMContentLoaded | 463 ms |
| Load | 652 ms |
| Finish | 4.86 s |

### Requests per screen

| Screen | Requests |
|---|---|
| Workout | 16 |
| Home | 20–28 |
| Nutrition | 28 |
| **Health** | **53–85** |

### The verdict

**Geography and server compute are no longer the problem.** With Postgres co-located in Singapore,
essentially every call returns in 1–25 ms, most from `(disk cache)`. The decision table above lands
on *many fast calls, slow total*.

**Three concrete causes were found, none of which were Phase 3:**

1. **`/api/oura/stats` — 1.37–1.60 s**, the whole of the reported "screens have no content for a
   second". It awaited two live Oura Cloud calls per request for a battery value frozen since the
   BLE re-key and a static ring configuration. Fixed in **#885**.
2. **`favicon.ico` — 338 ms to 1.43 s, twice per screen.** A 26 kB icon matching no cache-first rule,
   re-downloaded on every screen change. Fixed in **#881**.
3. **The Health screen fetches all three sub-tabs and renders one.** Re-scoped as Phase 4.

Also observed, not yet investigated: the console emits hundreds of `CapacitorSQLite.query` calls in a
burst on screen load. Entirely on-device, so no network work addresses it. **No backlog entry yet —
needs one if it proves to be an N+1 pattern.**

### Consequence for Phase 3

**⚠️ Corrected 2026-07-29.** An earlier revision said Phase 3 was "provisionally unnecessary and
should not be built." That judged it purely as a latency optimisation, and on that basis it does look
marginal — the blank second was a blocking API call, not the remote shell, and `DOMContentLoaded` was
already 463 ms.

**The owner's direction is app-native: everything on device, Postgres demoted to sync and
redundancy.** Bundling the shell *is* that direction, so it is architecture rather than an
optimisation to decline on a millisecond count. **Build it** — sequenced after Phase 4.

What the measurement does change is expectations, not the decision:

- It buys **cold start and hard reloads only.** Tab switches are already local and non-tab routes are
  RSC fetches, so it will not make navigation faster — that part is done.
- Cold start after the fixes is dominated by **JS parse and execute**, not the document fetch (the
  reload above moved 1,076 kB against 3,356 kB of resources). Bundling removes the network hop for
  that JS but not the time spent running it. It will not by itself make launch instant.

### What happened to Phase 2

Its cached-document half was **reverted (#891)** after breaking cold start on device — the app
painted its shell then sat without data for close to two minutes. A cached document carries an old
Next build id; the RSC fetch mismatches, Next hard-reloads, the worker re-serves the same stale
document, and it loops. **Retaining two cache generations does not bound this** — `activate` only
runs when a new worker installs, so the retained generation is whatever was current at the last *app
open*, not the previous deploy. Any retry must verify the build id against the server, not bound age.
The icon caching was kept; it has no build id.

---

## What has NOT been verified

Per `CLAUDE.md`'s communication rule, the failure surfaces this plan does not exercise:

- **Production server compute per endpoint** — attempted, not obtained (see above).
- **Real Brisbane→Singapore latency** — not measurable from a US sandbox.
- **The post-move improvement** — both services are now in Singapore, but no measurement has been
  taken from the device since.
- **Safe-area / native / Samsung WebView behaviour** — Task 1 touches no layout, but the
  device-smoke checklist still applies to anything Phase 2+ ships.
