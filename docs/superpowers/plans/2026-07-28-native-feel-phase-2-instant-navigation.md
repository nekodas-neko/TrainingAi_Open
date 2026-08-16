# Native Feel Phase 2 — Instant Navigation (service-worker stale-while-revalidate)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cold start and non-tab route changes paint from cache immediately instead of waiting
on a network round trip, without reintroducing Next.js deployment skew.

**Architecture:** The service worker currently goes network-first for both the HTML document and
RSC payloads. Both become stale-while-revalidate: serve the cached copy instantly, refresh in the
background, and let Next's own build-ID mismatch handling self-heal the one-deploy-stale case that
the existing two-generation cache retention already keeps loadable.

**Tech Stack:** `public/sw-template.js`, `app/sw.js/route.ts` (build-SHA cache stamping).

**Prerequisite:** Phase 0 of [`2026-07-28-native-feel-roadmap.md`](2026-07-28-native-feel-roadmap.md)
should be done first. This plan is still correct without it, but Phase 0 tells you how much it buys.

---

## Source-verified finding that shapes this plan

**Non-tab routes are entered by client-side navigation, not document loads.** There are 39
`router.push(...)` call sites and 9 `next/link` importers across `app/` and `components/`, and no
`window.location` navigation to an in-app route. Consequently:

| Path | What the SW sees | Which branch handles it today |
|---|---|---|
| Tab switch (home/health/workout/nutrition/more) | *nothing* — `TabShell` swaps a mounted component and calls `replaceState` | none; no request at all |
| Non-tab route via `router.push` (`/workout`, `/config`, `/history`, `/stats`, `/chat`) | an RSC payload request | **"everything else"** — network-first (`sw-template.js:161`) |
| Cold start / hard reload / notification tap | a document request with `mode === 'navigate'` | **navigate** — network-first (`sw-template.js:137`) |

**So fixing only the `navigate` branch would fix only cold start.** Both branches must change, and
they are the two tasks below. An earlier framing of this work as "every screen change waits for a
round trip" was wrong (retracted in #876) — tab flips are already instant.

## Why the deployment-skew objection is weaker than the comment claims

`sw-template.js:126-135` explains network-first as protection against a cached document referencing
a previous build's chunks. Three facts bound that risk:

1. **Two cache generations are already retained.** `activate` (`sw-template.js:18-38`) keeps the
   current cache *and* `prev`, so a document one build stale still resolves its chunks.
2. **The cache name is build-stamped from the deploy SHA** (`app/sw.js/route.ts` injects
   `RAILWAY_GIT_COMMIT_SHA`), so a new deploy produces a new SW, a new cache, and an `activate` that
   re-anchors `prev` — the staleness window is exactly one generation, not unbounded.
3. **Next.js detects build-ID mismatch on RSC requests and performs a hard reload**, which is the
   self-heal path for the case where the stale document *does* outlive its chunks.

**Residual risk, stated plainly:** a user who opens the app across two deploys without the SW ever
activating in between could get a document whose chunks are gone. The symptom is one hard reload,
not a broken app. Task 3 adds a guard that makes this explicit rather than incidental.

---

## Task 1: Serve the document (navigate) branch stale-while-revalidate

**Files:**
- Modify: `public/sw-template.js:136-156`

- [ ] **Step 1: Read the current navigate branch**

Run: `sed -n '126,157p' public/sw-template.js`
Expected: the `AUTH_PAGES` const, then an `e.respondWith` that awaits `fetch(e.request)` first and
falls back to cache only in the `catch`.

- [ ] **Step 2: Replace the branch body with cache-first + background revalidate**

Replace the whole `if (e.request.mode === "navigate" && !AUTH_PAGES.includes(url.pathname)) { ... }`
block with:

```js
  // Top-level navigations (cold start, hard reload, notification tap): serve the
  // last-known document immediately and refresh it in the background. The APK is a
  // WebView on a remote URL, so network-first meant every cold start waited a full
  // round trip before it could paint anything.
  //
  // Deployment skew is bounded, not ignored: `activate` retains this build's cache
  // AND the previous one, so a one-generation-stale document still resolves its
  // chunks, and Next.js hard-reloads on a genuine build-ID mismatch.
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

        if (cached) return cached;
        const fresh = await network;
        if (fresh) return fresh;
        const offline = await caches.match(OFFLINE_URL);
        return offline ?? Response.error();
      })()
    );
    return;
  }
```

Note `AUTH_PAGES` stays excluded — a cached `/sign-in` would serve a stale CSRF token.

- [ ] **Step 3: Verify no syntax error in the worker**

Run: `node --check public/sw-template.js`
Expected: no output (exit 0). The file contains `__CACHE_NAME__`/`__PRECACHE_URLS__` placeholders
that are *values*, not syntax, so `--check` still parses it.

- [ ] **Step 4: Commit**

```bash
git add public/sw-template.js
git commit -m "Serve the app document from cache while refreshing it in the background

Cold start waited a full round trip to the other side of the ocean before it
could paint. The retained previous cache generation keeps a one-deploy-stale
document's chunks resolvable, and Next hard-reloads on a real build-ID mismatch."
```

---

## Task 2: Serve RSC payloads stale-while-revalidate

This is the branch that actually governs `/workout`, `/config`, `/history`, `/stats` and `/chat`.

**Files:**
- Modify: `public/sw-template.js:158-176` (the "everything else" branch)

- [ ] **Step 1: Read the current fallthrough branch**

Run: `sed -n '158,177p' public/sw-template.js`
Expected: `e.respondWith(fetch(e.request).then(...).catch(...))` — network-first with an exact-match
cache fallback.

- [ ] **Step 2: Split RSC GETs out of the fallthrough into their own SWR branch**

Insert this **immediately before** the final `e.respondWith(...)` fallthrough:

```js
  // RSC payloads for client-side navigations (router.push to /workout, /config,
  // /history, /stats, /chat). These, not document loads, are what a non-tab screen
  // change actually fetches — so this is the branch that decides whether changing
  // screen feels instant. Same SWR contract as the document branch above.
  //
  // GET only: a Server Action posts to the same URL shape with ?_rsc absent but
  // method POST, and must never be served from cache.
  if (e.request.method === "GET" && url.searchParams.has("_rsc")) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(e.request);
        const network = fetch(e.request)
          .then((res) => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => null);
        return cached ?? (await network) ?? Response.error();
      })()
    );
    return;
  }
```

- [ ] **Step 3: Verify the worker still parses**

Run: `node --check public/sw-template.js`
Expected: exit 0.

- [ ] **Step 4: Confirm auth pages and Server Actions are still excluded**

Run: `grep -n '_rsc\|AUTH_PAGES\|method === "GET"' public/sw-template.js`
Expected: the `_rsc` branch guards on `method === "GET"`, and `AUTH_PAGES` still appears in the
navigate branch. A POST (Server Action) must fall through to the network-first branch.

- [ ] **Step 5: Commit**

```bash
git add public/sw-template.js
git commit -m "Serve RSC payloads from cache while refreshing them

Changing to a non-tab screen fetches an RSC payload, not a document, so the
document branch alone never touched it — these routes still waited a round trip
after cold start was fixed."
```

---

## Task 3: Make the skew window explicit with a build-ID guard

Tasks 1–2 rely on Next's own mismatch handling. This task makes the SW *notice* a stale generation
instead of depending on it, which is what turns the residual risk from incidental into handled.

**Files:**
- Modify: `public/sw-template.js` (activate handler, `sw-template.js:18-38`)

- [ ] **Step 1: Record the build stamp at activate time**

Inside the `activate` handler, immediately after `await meta.put("prev", new Response(CACHE));`, add:

```js
      // Record when this generation activated. A document served from a cache whose
      // generation is more than one behind current is the only case the retained
      // `prev` does not cover, so drop those rather than serve chunks that are gone.
      await meta.put("current", new Response(CACHE));
```

- [ ] **Step 2: Drop cached documents from generations older than `prev`**

In the navigate branch from Task 1, replace `const cached = await caches.match(e.request);` with:

```js
        // Only serve a cached document from the current or immediately-previous
        // generation — older ones may reference chunks `activate` has already deleted.
        const meta = await caches.open(META);
        const prevRes = await meta.match("prev");
        const prevName = prevRes ? await prevRes.text() : null;
        const liveNames = [CACHE, ...(prevName ? [prevName] : [])];
        let cached = null;
        for (const name of liveNames) {
          const c = await caches.open(name);
          cached = await c.match(e.request);
          if (cached) break;
        }
```

- [ ] **Step 3: Verify the worker parses and META is in scope**

Run: `node --check public/sw-template.js && grep -n 'const META' public/sw-template.js`
Expected: exit 0, and `META` declared at module scope (line 3) so the fetch handler can read it.

- [ ] **Step 4: Commit**

```bash
git add public/sw-template.js
git commit -m "Only serve cached documents from a generation whose chunks still exist

Serving the document from cache is safe one deploy back because activate retains
that generation; beyond that its chunks are deleted, so prefer the network."
```

---

## Task 4: Verify on the device — this is the merge gate

**The sandbox renders none of this.** A service worker on `localhost` over `pnpm dev` does not
exercise the APK's remote-URL cold start, and deployment skew cannot occur without a real deploy.
Per `CLAUDE.md` (Canonical Runtime), a SW change touches the notification transport, so it needs the
on-device smoke run **or** an explicit Known-Issues row.

- [ ] **Step 1: Deploy the branch and install on the S25**

Merge to a preview or deploy the branch, then open the APK.

- [ ] **Step 2: Cold start twice**

Force-stop the app, launch, and time to first content. Then force-stop and launch again.
Expected: the second launch paints the last-known screen immediately, with data refreshing behind it.
Broken outcome: a blank or spinner on the second launch — SWR is not being hit.

- [ ] **Step 3: Non-tab navigation**

From home, open `/workout`, back out, and open it again.
Expected: the second open paints instantly.

- [ ] **Step 4: The skew case — the one that matters**

With the app open, deploy a *new* build to Railway. Then, on the phone, navigate around and reload.
Expected: the app either continues working or performs exactly one hard reload and then works.
Broken outcome: a "resource won't load" error or a white screen that does not self-heal. **If this
happens, revert Task 1 and 2 and re-plan — do not ship it behind a Known-Issues row.**

- [ ] **Step 5: Push notification still arrives**

Trigger a push. Expected: it arrives and tapping it opens the right screen. The SW is the push
transport; a broken `fetch` handler must not have disturbed `push`/`notificationclick`.

- [ ] **Step 6: Record the result**

If all pass, note it in the PR. If the device is unavailable, add a Known-Issues row to
`projectOverview.md` marking Phase 2 **not device-verified** — but note that Step 4 is a
correctness gate, not a polish check, so shipping unverified carries real risk.

---

## Rollback

Every task is confined to `public/sw-template.js`. Reverting the commits restores network-first.
Because the cache name is build-stamped from the deploy SHA, a revert deploy mints a fresh cache
generation, so no stale SWR-cached document survives the rollback.
