# Service-Worker Deploy-Skew Fix — Navigation → Network-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate Next.js deployment-skew crashes on the APK by making the service worker's top-level navigation handler **network-first** instead of stale-while-revalidate, while preserving the offline-shell cold-start behaviour. Closes the session-288 Known Issue "Service-worker navigation is stale-while-revalidate → deploy-skew risk".

**Context:** The canonical runtime is an Android WebView (Samsung S25) pointed at the remote Railway URL (`capacitor.config.ts` `server.url`). `main` auto-deploys to Railway many times a day. The SW currently serves navigation documents cache-first (SWR) and retains the previous cache generation across a deploy. Because the WebView loads the live Railway URL and the server keeps redeploying, a cold start / reload can be served an **old cached HTML document** whose JS chunks / RSC then mismatch the newer live server → Next.js deployment skew → "resource won't load" / runtime crashes. `caches.match` also returns the *oldest* matching cache, so the client can stay pinned to a stale build even while online. This is a latent hardening — it was **not** the cause of the session-288 HR-chart crash; it is a separate fix.

**Architecture:** A single, surgical change to one branch of the `fetch` handler in `public/sw-template.js` — the top-level navigation branch guarded by `if (e.request.mode === "navigate" && !AUTH_PAGES.includes(url.pathname))` (currently ~lines 126–157). No schema changes, no data-path semantics change, no APK rebuild. This is a JS/server change that ships via Railway into the WebView.

**Tech stack:** Service worker (`public/sw-template.js`), the SW route (`app/sw.js/route.ts`, reads the template from disk at runtime and caches by `BUILD_ID`), `renderServiceWorker` (`lib/sw/manifest.ts`, injects `__CACHE_NAME__`/`__PRECACHE_URLS__`).

**Verification reality (read first):**
- The **online-fresh** and **offline-fallback** mechanics are fully verifiable in-sandbox with a persistent-profile Chromium (Playwright `launchPersistentContext`, `serviceWorkers: 'allow'`) — see Task 3.
- **Deploy-skew itself is only fully verifiable across a real Railway deploy cycle**, which the sandbox cannot reproduce. The two-build local repro (Task 3, Step 1) proves the served document flips from build A → build B on reload in the same warmed profile — that is the mechanism — but the true end-to-end confirmation (airplane-mode cold start, then a mid-session Railway deploy adopted on next navigation) is **owner-run on the S25**. State this explicitly when presenting.

**Do NOT touch** the other `fetch`-handler branches — `/exercise-media/` (cache-first), `/api/exercise-gif` (SWR), `/api/*` (network-only), `/_next/static/` (cache-first), or the final "everything else / RSC" branch (already correctly network-first). Keep the `AUTH_PAGES` exclusion and the activate-time cache-generation retention **as-is** — retention becomes harmless once nav is network-first (it is only consulted on the offline fallback path).

---

## Task 1: Change the navigation branch to network-first

**File:** Modify `public/sw-template.js` (the navigation branch, ~lines 126–157)

- [ ] **Step 1: Replace the SWR navigation block with network-first**

Replace the current block:

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
```

with:

```js
  // Top-level navigations: network-first. Because the APK is a WebView on the
  // live Railway URL and main redeploys constantly, a cached document can carry
  // an old build's chunk/RSC references that mismatch the newer live server
  // (Next.js deployment skew → "resource won't load" / runtime crash). Always
  // fetch the live document when online so it matches the current build; a
  // mid-session deploy self-heals on the next reload. Cache the fresh copy only
  // so the offline path below has a last-known document to serve. On network
  // failure, fall back to the cached copy of this exact route, then the
  // precached /offline shell. Auth pages are handled by the network-first
  // "everything else" branch below.
  const AUTH_PAGES = ["/sign-in", "/pending", "/register"];
  if (e.request.mode === "navigate" && !AUTH_PAGES.includes(url.pathname)) {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(e.request);
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        } catch {
          const cached = await caches.match(e.request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return offline ?? Response.error();
        }
      })()
    );
    return;
  }
```

**Notes for the implementer:**
- Only `res.ok` responses are cached — a 500/redirect must never poison the per-route cache entry (same guard the SWR version and the sibling branches use).
- The offline fallback chain is preserved: exact cached route → precached `OFFLINE_URL` → `Response.error()`.
- Keep `AUTH_PAGES` declared here even though auth pages now fall through — the guard still excludes them from this branch, matching the pre-existing structure. (Auth pages were already network-first via the final branch; behaviour for them is unchanged.)
- Do **not** alter the `activate` handler's previous-generation retention. It is now only reachable on the offline fallback path, which is harmless and still desirable for offline cold-start coverage.

- [ ] **Step 2: Confirm the rendered template still parses**

The SW is served through `renderServiceWorker` (`lib/sw/manifest.ts`), which injects `__CACHE_NAME__`/`__PRECACHE_URLS__`. Validate the *rendered* output parses as a function body (catches a stray brace/paren in the edit):

```bash
node -e '
  const { readFileSync } = require("fs");
  const { renderServiceWorker } = require("./lib/sw/manifest.ts");
  const tmpl = readFileSync("public/sw-template.js", "utf-8");
  const body = renderServiceWorker(tmpl, { cacheName: "ta-test", precacheUrls: ["/offline"] });
  new Function(body); // throws on a syntax error
  console.log("SW parses OK");
'
```

If `lib/sw/manifest.ts` cannot be `require`d directly (TS), inline the two `.replace(...)` calls the function performs (`__CACHE_NAME__` → a string, `__PRECACHE_URLS__` → `'["/offline"]'`) before `new Function(body)`, or wrap in `pnpm tsx`. Expected: `SW parses OK`.

- [ ] **Step 3: Commit**

```bash
git add public/sw-template.js
git commit -m "Serve top-level navigations network-first to prevent deploy-skew crashes"
```

---

## Task 2: Full CI gate

- [ ] **Step 1: Run the full gate**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

Expected: all green. The SW template is a plain `.js` asset read at runtime — the build does not typecheck it, so the Task 1 Step 2 parse check is the real syntax gate; still run the full suite for the changelog/version files touched in Task 4.

---

## Task 3: In-sandbox verification (mechanics only — deploy skew is owner-gated)

> All three checks run against a locally-built server. `pnpm start` runs `NODE_ENV=production`, which forces `pg` SSL — either enable SSL on the local Postgres cluster (self-signed cert in the cluster dir owned by the `postgres` user, `ssl = on`, restart via `su postgres -c 'pg_ctl ... restart'`) **or** exercise only unauthenticated navigation routes (`/offline`, `/sign-in`, and any page whose first paint doesn't require a session). `unset DATABASE_URL DATABASE_SSL` before build/start (the container pre-sets prod values); set a fixed `AUTH_SECRET` if you need to mint a session cookie (seeded user `test@local.dev` / `testpass123`, already `is_active`). Use the pre-installed Chromium at `/opt/pw-browsers/` via Playwright `launchPersistentContext` with `serviceWorkers: 'allow'` so CacheStorage + the SW survive between reloads.

- [ ] **Step 1: Two-build skew repro (the headline mechanism)**

  1. `pnpm build` (build A) → `pnpm start` on a fixed port with a pinned `RAILWAY_GIT_COMMIT_SHA` (e.g. `RAILWAY_GIT_COMMIT_SHA=aaaaaaaaaaaa`).
  2. Warm a **persistent** Chromium profile: `launchPersistentContext(userDataDir, { serviceWorkers: 'allow' })`, visit a navigation route, wait for the SW to register and the document to be cached.
  3. Make a trivial visible change to a shared component (so the rendered HTML differs between builds).
  4. Rebuild (build B) → restart `pnpm start` with a **new** SHA (`RAILWAY_GIT_COMMIT_SHA=bbbbbbbbbbbb`).
  5. Reload the same route **in the same warmed profile**.
  6. **Expected (fixed):** the served document is **build B** (fresh), not the cached build A. Assert on the trivial change being present. (Before the fix, SWR would serve build A on this reload and only revalidate in the background.)

- [ ] **Step 2: Offline still works**

  1. In the warmed profile (a route already visited online, so cached), `context.setOffline(true)`, reload → **serves the cached document** (no error page).
  2. Navigate to a route **not** previously visited → serves the precached **`/offline`** shell.
  3. **Expected:** both succeed — the network-first branch's `catch` falls back to the exact cached route, then `OFFLINE_URL`.

- [ ] **Step 3: Record what was NOT verified**

  Deploy skew across a **real Railway deploy** cannot be reproduced in the sandbox. The Task 3 Step 1 local two-build repro proves the served-document-flips mechanism; the true end-to-end (airplane-mode cold start, then a live mid-session Railway deploy adopted on next navigation) is **owner-run on the S25**. Note this explicitly in the PR description and in the session journal.

---

## Task 4: Bookkeeping (same PR)

- [ ] **Step 1: Version + changelog**

  This is a user-visible reliability fix (fewer post-deploy crashes) → **patch bump**. Bump `package.json` `version` and add a `lib/changelog.ts` entry (patch), describing it in user terms (e.g. "More reliable app loading right after an update").

- [ ] **Step 2: Remove the Known-Issues row**

  Delete the "Service-worker navigation is stale-while-revalidate → deploy-skew risk (session 288)" row from `projectOverview.md` (it currently sits in the Known Issues section, ~line 2559). Replace with nothing — the fix supersedes it.

- [ ] **Step 3: Journal + index**

  Append the session summary to `docs/overview/history-current.md` (start a new `history-*.md` if it nears ~250 KB) and update `projectOverview.md`'s lean index (current status; note the deploy-skew hardening shipped; flag the on-device cross-deploy verification as owner-run). Remove this item's entry from `docs/implementation-backlog.md` in the **same PR**.

- [ ] **Step 4: PR + green CI**

  Fresh branch off latest `main` (`git fetch origin main && git remote prune origin && git checkout -B fix/sw-navigation-network-first origin/main`), no AI attribution in commits. Open the PR, get all six required checks green (Lint, Type Check, Tests, Build, Custom Rules, Migration Check). The real merge gate is on-device — flag if no device is available (airplane-mode cold start + post-deploy navigation).

---

## Rollback

The change is one branch of one file. If a post-deploy issue is suspected (e.g. a route that legitimately needs the cached-first path), revert the Task 1 commit — the SW route reads the template from disk at runtime and caches by `BUILD_ID`, so a fresh server process picks up the reverted template on the next deploy. No migration, no data implications.
