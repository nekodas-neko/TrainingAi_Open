# Native Feel Phase 3 — Bundle the App Shell into the APK

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop fetching the application shell over the network. Ship the UI inside the APK so cold
start costs nothing, and let only *data* cross the ocean — the last structural difference between
this app and a native one.

**Architecture:** Convert the WebView from a remote-URL loader into a local-asset loader. The
Next.js app splits in two: a **client-rendered shell** exported statically and bundled into the APK,
and the **API surface** which stays on Railway exactly as it is today. Authentication moves from a
server-side `auth()` call in React Server Components to a client-held token attached to API calls.

**Tech Stack:** Next.js 15 `output: 'export'`, Capacitor 7, NextAuth v5 (JWT session), the existing
194 API routes (unchanged).

---

## ⚠️ Read this before starting

**This is a project, not a task.** It is the largest change on the native-feel roadmap and it
touches authentication — a confirm-first area under `CLAUDE.md`'s Safety rules. Do not begin
implementation without the owner's explicit go-ahead on the auth model in Task 1.

**This is the intended architecture — build it.** The owner's stated direction (2026-07-29) is
app-native: everything on device, with Postgres demoted to sync and redundancy rather than the source
of truth. Bundling the shell is what stops the UI being fetched from a server at all, so it is the
direction rather than an optimisation to weigh on a millisecond count.

**An earlier revision of this plan, and of the backlog entry, said this "may not be worth its cost"
and later "should not be built." Both are retracted.** They judged it purely on latency after Phase 0
showed the blank second was a blocking Oura Cloud call rather than the remote shell. That reasoning
was sound about *performance* and wrong about *scope* — it treated an architectural decision as a
perf trade.

**What Phase 0 legitimately changes is expectations, not the decision:**

- It buys **cold start and hard reloads only.** Source-verified: tab switches are already local
  (`TabShell` swaps mounted components) and non-tab routes are `router.push` RSC fetches. Do not
  expect faster navigation — that is already done.
- Cold start is now dominated by **JS parse and execute**, not the document fetch (a warm reload
  moved 1,076 kB against 3,356 kB of resources, with `DOMContentLoaded` at 463 ms). Bundling removes
  the network hop for that JS but **not** the time spent running it. It will not by itself make
  launch instant, and anyone expecting that from this project will be disappointed.

**Sequencing: after Phase 4.** Phase 4 is small, self-contained, and reduces the work the shell does
at startup — which makes this project's payoff easier to see.

### What it actually costs — measured scope

| Surface | Count | Source |
|---|---|---|
| Page routes | 40 | `find app -name page.tsx` |
| Pages calling `await auth()` server-side | 20 | `grep -rl "await auth()" app/ --include=*.tsx` |
| Root layout calling `auth()` | 1 | `app/layout.tsx:101` |
| Route-protecting middleware | 1 | `middleware.ts:9` (`export default auth((req) => {...})`) |
| API routes (unaffected — stay on Railway) | 194 | `find app/api -name route.ts` |

Every one of the 21 server-side `auth()` sites must become client-side, and `middleware.ts` cannot
run at all in a static export. That is the real work; the Capacitor config change is trivial.

---

## Task 1: Decide and document the auth model — OWNER GATE

**No code. This task exists because the rest of the plan is unsafe to write against an unconfirmed
auth design, and auth changes are confirm-first.**

Today: NextAuth issues a JWT **session cookie**; `middleware.ts` gates routes; server components read
`auth()` and redirect. With a statically-exported shell loaded from `capacitor://localhost` or
`https://localhost`, **the Railway cookie is cross-origin and will not be sent by default.**

- [ ] **Step 1: Choose the model and get the owner's sign-off**

| Option | How it works | Trade-off |
|---|---|---|
| **A. Bearer token in native secure storage** (recommended) | Sign-in happens in a system browser / existing `auth-mobile-bridge` flow, returns a token, stored via a Capacitor secure-storage plugin, attached as `Authorization: Bearer` by a single fetch wrapper | Every API route must accept bearer auth alongside the cookie. Clean, standard, survives the origin change. The `app/auth-mobile-bridge/` route already exists and does something close to this |
| **B. Cross-origin cookie** (`SameSite=None; Secure`, CORS with credentials) | Keep cookies, add CORS | Weaker CSRF posture, and `SameSite=None` on a session cookie is exactly the thing the current setup avoids. Not recommended |

- [ ] **Step 2: Confirm the API-side change is acceptable**

Option A means every protected API route resolves identity from **either** the cookie **or** a
bearer token. That is a change to the auth boundary on 194 routes and must go through one shared
helper, never per-route. Note `ADMIN_EXPORT_SECRET` already establishes the precedent that a bearer
path may widen *transport* without widening *authority*.

- [x] **Step 3: Write the decision into this file before proceeding**

### ✅ DECISION — Option A, bearer token in native secure storage. Owner-confirmed 2026-07-29.

The owner was given the two options above and chose **A** explicitly. The gate is satisfied; Tasks 2
onward may proceed.

What that commits us to, stated here so it is not re-litigated per-task:

- Identity on a protected API route resolves from **either** the existing session cookie **or** an
  `Authorization: Bearer` token, through **one shared helper**. Never per-route. The cookie path stays
  working throughout, so the web/dev surface and the current remote-loading APK keep functioning while
  the migration is in flight — this is what makes Tasks 1–3 individually revertible.
- The bearer path widens **transport, not authority**: the resolved user still passes every existing
  ownership and admin check unchanged. `ADMIN_EXPORT_SECRET` is the in-repo precedent
  (`app/api/admin/day-review`), and it fails closed when its env var is unset — the same posture
  applies here.
- Token storage is a Capacitor secure-storage plugin, not `localStorage`. A session token in
  `localStorage` is readable by any injected script in the WebView, which is a real downgrade from an
  `httpOnly` cookie; secure storage is what keeps the change neutral rather than weakening.
- `app/auth-mobile-bridge/` already exists and does something close to the sign-in handoff, so it is
  the starting point rather than a new flow.

**Still confirm-first even with the gate passed:** merging the change that makes the 195 API routes
accept bearer auth is an auth-boundary change under `CLAUDE.md`'s Safety rules, so that PR gets
presented and confirmed before merge rather than auto-merged on green CI.

---

## Task 2: Prove a static export is even possible — spike, throwaway

Do this before committing to the migration. If it fails, the project changes shape.

**Files:**
- Modify (temporarily): `next.config.ts`

- [ ] **Step 1: Try the export on a scratch branch**

Add `output: 'export'` to the config object in `next.config.ts` and run:

Run: `pnpm build`
Expected: it **fails**, listing every route incompatible with static export — the 20 `auth()` pages,
`middleware.ts`, and all 194 API routes.

- [ ] **Step 2: Capture the failure list**

Run: `pnpm build 2>&1 | tee /tmp/export-errors.txt; grep -c "" /tmp/export-errors.txt`
Expected: a concrete inventory. **This list is the actual work-plan for Task 3** — it is more
reliable than any inventory written by hand, so generate it rather than assuming the counts above
are complete.

- [x] **Step 3: Discard the spike**

Run: `git checkout next.config.ts`
Expected: clean tree. Do not carry the spike forward; Task 4 reintroduces the flag deliberately.

---

### ⚠️ SPIKE RESULT 2026-07-29 — the project changes shape. Read before Task 3.

**Task 2's stated expectation was wrong in two ways, and the second one is structural.**

**1. There is no inventory to capture.** Step 2 assumed `pnpm build` would list every incompatible
route. It does not — Next fails on the *first* one and stops:

```
Error: Page "/api/activity-logs/[id]/metrics" is missing "generateStaticParams()"
       so it cannot be used with "output: export" config.
```

So the "generate the list rather than assuming the counts" instruction cannot be followed as written.
The inventory below was enumerated by hand instead.

**2. `output: 'export'` cannot coexist with this app's API routes in the same build — at all.**
The plan's architecture line says the API surface "stays on Railway exactly as it is today", which is
the right intent, but `output: 'export'` is a **whole-app flag**. It does not export the shell and
leave `app/api` alone; it applies to every route in the build.

Measured on `main` (2026-07-29):

| | count | exportable? |
|---|---|---|
| API routes total | 195 | — |
| …with ≥1 non-GET handler (POST/PATCH/PUT/DELETE) | **105** | **No** — static export supports only statically-renderable GET |
| …GET-only | 89 | of which **87 call `await auth()`**, i.e. dynamic → **No** |

That leaves ~2 of 195 routes theoretically exportable. **The API surface must be built separately
from the shell.** Flipping the flag in Task 4 is therefore not a one-line change, and Task 4 as
written cannot work.

**This does not invalidate the goal, and it does not invalidate Task 3.** Client-side auth + a bearer
token is a prerequisite under *every* option below, because in all of them the shell is served from a
different origin than the API. Task 3 remains safe to land incrementally.

**What needs an owner decision before Task 4 is attempted** (recorded, not chosen — do not pick one
unilaterally):

| Option | Shape | Cost |
|---|---|---|
| **A. Two builds from one repo** | A second config/build that excludes `app/api`, producing `out/` for Capacitor while the normal build still serves Railway | Next has no first-class route exclusion; needs a build step that moves/ignores `app/api`. Fragile but contained |
| **B. Split into two apps** | `shell/` (exported) + `api/` (server), sharing `lib/` via a workspace package | Cleanest end state, matches the "app-native, Postgres as sync" direction, but a large repo refactor |
| **C. Abandon `output: 'export'`** | Keep the Next server and have Capacitor bundle only a minimal boot page | Loses most of the benefit — the shell JS still comes from the network |

**Also found:** `output: 'export'` disables `next.config.ts`'s `headers` entirely —

```
⚠ Specified "headers" will not automatically work with "output: export"
```

Task 4 Step 4 anticipates editing the CSP's `connect-src`, but the real effect is broader: the CSP
**and** the `Cache-Control: private, max-age=60, stale-while-revalidate=120` headers that the
aggregate GET routes rely on both stop being applied to the exported shell. Under options A and B the
API build keeps its own headers, so this affects the shell's own document only — but the CSP must
then be delivered another way (a `<meta http-equiv>` tag or the native layer), or the shell ships
with no CSP at all.

---

## Task 2b: Auth preconditions found by reading the current code (2026-07-29)

Three things the code says that Tasks 1 and 3 above do not. Read these before writing any auth code —
the first is an auth hole the plan as written would open.

### (a) `isActive === false` is enforced in exactly one place, and it is the middleware

`middleware.ts:18` bounces a signed-in-but-deactivated user to `/pending`. **No page-level preamble
checks it** — `rg "isActive" app/**/page.tsx` returns nothing. Task 3 Step 2 describes replacing the
preamble `if (!session?.user?.id) redirect("/sign-in")`, and a client gate that reproduces only that
predicate **lets every deactivated user with a live JWT into every screen.**

This is not theoretical. `auth.ts:32` returns the user from `authorize` *deliberately* even when
`isActive` is false ("signIn callback handles the redirect"), so the `jwt` callback still stamps
`token.isActive = false` and a real session token exists. The middleware check is what makes
deactivation stick on every subsequent request. Static export runs no middleware.

**The client gate must reproduce both predicates**, not one: no session → `/sign-in`; session with
`isActive === false` → `/pending`.

Related, and worth deciding separately: `auth.config.ts:35` only sets `token.isActive` when a `user`
object is present — i.e. at sign-in. A user deactivated *after* signing in keeps `isActive: true` in
their JWT until it is re-minted, and no amount of gating (middleware or client) sees the change. That
is a pre-existing weakness, not one this migration introduces, but moving the check client-side makes
it strictly easier to get wrong. If deactivation needs to take effect promptly, it has to be
re-checked server-side per request, which the bearer resolver in Task 3 is the natural place for.

### (b) The matcher is a negative pattern — it guards 36 routes, not 20

Task 3 says "the 20 `app/**/page.tsx` files from Task 2's list". `find app -name page.tsx` returns
**40**, and the matcher

```
"/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon|apple-icon).*)"
```

is an exclusion list, so it guards *everything* except those assets and the four `PUBLIC_PATHS`
(`/sign-in`, `/pending`, `/register`, `/offline`, matched by `startsWith`) — 36 routes.

Step 4 says to "enumerate exactly which paths it currently guards and reproduce that list
client-side." **A positive list cannot faithfully reproduce a negative one**: every future route is
guarded by default today and would be unguarded by default under a whitelist. Reproduce it as a
default-deny with an explicit public list, mirroring `PUBLIC_PATHS` — not as an enumeration of the 36.

**`/mobile-signin` is guarded today, and that looks like a live first-run bug** — see the
projectOverview Known Issues row. Measured against `pnpm dev`: unauthenticated
`GET /mobile-signin?challenge=abc` returns `307 → /sign-in`, dropping the challenge. Do not "preserve
current behaviour" here without reading that row first; the current behaviour may itself be wrong.

### (c) The bearer token should be the existing session JWT — the flow is already built

Task 1's Option A says the `auth-mobile-bridge` route "already exists and does something close to
this". It is closer than that. The flow is complete today:

`/mobile-signin?challenge=<sha256>` (Custom Tab) → Google OAuth → `/auth-mobile-bridge` mints a
one-time PKCE-bound token (`lib/mobile-auth-tokens.ts`, 5-min TTL, consumed on first use, burned even
on a failed verifier) → `trainingai://` deep link → app POSTs `{token, verifier}` to
`/api/auth/exchange-mobile-token` → server responds `Set-Cookie: __Secure-authjs.session-token=<jwt>`.

The value in `TokenEntry.sessionCookieValue` **is the NextAuth session JWT**. So the bearer token
needs to be no new credential at all: have the exchange endpoint also return that JWT in the response
body, store it via Capacitor secure storage, and send it as `Authorization: Bearer <jwt>`. Same
signing key, same claims, same expiry, same revocation story as the cookie — the resolver verifies
one token type by two transports, which is exactly the `ADMIN_EXPORT_SECRET` precedent Task 1 cites.

This removes the largest unknown from Task 3: there is no token-issuance design to invent, no second
credential lifetime to reason about, and the PKCE hardening already written is reused as-is. Do not
mint a new token type without a specific reason the session JWT cannot serve.

---

## Task 3: Move authentication client-side, one page at a time

**This is the bulk of the project and must not be one commit.** Each of the 21 sites converts
independently and ships independently — the app keeps working throughout because the server-side
path stays valid until the last one is gone.

> **Read Task 2b first — it corrects three things in the steps below.** In short: the client gate
> must reproduce **two** predicates, not one (a session check alone lets deactivated users in); the
> route list is 36 guarded of 40, not 20, and must be reproduced as default-deny rather than as a
> whitelist; and the bearer token is the existing NextAuth session JWT, not a new credential.

**Task 3 is not blocked by the Task 4 owner gate** — a bearer token is a prerequisite under all three
build-split options, so this can proceed in parallel.

**Files (per site):**
- Modify: the guarded `app/**/page.tsx` files (36 of the 40 that exist — Task 2b), plus
  `app/layout.tsx:101`

- [ ] **Step 1: Build the client session hook once**

Create a single hook that reads the token chosen in Task 1 and exposes the same shape the server
components consume today (`userId`, `isAdmin`, `sex`, `heightCm`, `dateOfBirth`, `activityLevel`,
`friendCode` — the fields `TabPage` currently passes down, per `components/shell/tab-page.tsx`).
Every converted page uses this hook. **Do not** let pages hand-roll token reads.

- [ ] **Step 2: Convert one page and verify before converting the rest**

Start with the simplest of the 20 (not `layout.tsx`, not `workout`). Replace the
`const session = await auth(); if (!session?.user?.id) redirect("/sign-in")` preamble with the
client hook plus a client-side redirect.

Run: `pnpm dev`, sign in, open that route.
Expected: renders identically; signed-out access still redirects to `/sign-in`.

- [ ] **Step 3: Commit that one page, then repeat**

```bash
git add app/<route>/page.tsx
git commit -m "Read the session client-side on <route>"
```

Repeat for each remaining page. **Convert `app/layout.tsx` last** — it wraps everything, so a
mistake there breaks every screen at once.

- [ ] **Step 4: Replace `middleware.ts` route protection**

Static export runs no middleware. The gate moves into the shell's root client component: unauthenticated
users get the sign-in screen before any tab mounts.

Run: `grep -n "matcher" middleware.ts` to enumerate exactly which paths it currently guards, and
reproduce that list client-side. **A path silently dropped here is an auth hole**, so diff the two
lists explicitly rather than eyeballing them.

---

## Task 4: Separate the shell build from the API build — OWNER GATE

**The original Task 4 (add `output: 'export'`, drop `server.url`, done) cannot work.** The spike
above measured why: the flag is whole-app, and ~193 of 195 API routes are non-exportable. The steps
it listed are preserved at the bottom of this task as *Task 4c*, because they are still the final
steps — but only *after* the build is split, which is the decision below.

**Do not start Task 4 until the owner picks an option.** Task 3 is unaffected and can proceed in
parallel: a bearer token is required under all three options, since in every one the shell is served
from a different origin than the API.

### ✅ DECISION — Option B, two apps in a workspace. Owner-delegated 2026-07-30.

The owner was given the three options and delegated the choice, with stated criteria: **"best option
not easiest"**, **performance and efficiency**, and **"there will be more app updates in the future
too"**. On those criteria it is **B**, and the gate is satisfied — Task 3 and Task 4 may proceed.

Why B over A, stated here so it is not re-litigated:

- **Runtime performance is identical.** Both A and B end with a bundled shell on the device; neither
  is faster than the other. The criterion that actually discriminates is the third one — future
  updates — and that is a maintainability question, not a latency one.
- **A's cost is recurring, not one-off.** Its shell build mutates the tree (moving or ignoring
  `app/api` and `middleware.ts`) before `next build` and restores it after. That hazard is paid on
  *every* future build: the failure mode is a shell build silently including a stale route, or a
  Railway build running against a mutated tree. With ongoing updates, a recurring silent-failure
  risk is the wrong trade against a one-off refactor.
- **B is honest about what the two artefacts are.** Each app's config describes itself, with no
  build-time tree surgery and no env-flag branch in `next.config.ts`.
- **C was rejected** — it leaves the shell JS coming over the network, which is most of what Phase 3
  exists to remove, and the plan itself calls it a deferral rather than a delivery. It would also
  make Task 3 pure loss.

**Cost accepted:** B is the repo refactor. It touches every import path, is multi-session, and wants
sequencing (workspace + shared `lib/` first, then the app split, then Task 4c) so each step is
independently revertible.

**Sizing honesty carried forward:** Phase 3 buys cold start and hard reloads only — navigation is
already local, and cold start is now dominated by JS parse/execute, which bundling does not remove.
The case for B rests on the app-native architectural direction, not on a millisecond count. That was
true before this decision and remains true after it.

- [x] **Step 0: Owner picks A, B, or C** — B, above.

The three options were recorded in the spike result above. Concrete shape of each:

### Option A — two builds from one repo

Keep one Next app. Add a second build that excludes `app/api`, producing `out/` for Capacitor, while
the normal build continues to serve Railway.

1. Add a shell-only build script that moves or ignores `app/api` (and `middleware.ts`, which export
   also drops) before running `next build` with `output: 'export'`, then restores the tree.
2. Gate the export config on an env flag — `output: process.env.SHELL_BUILD ? 'export' : undefined` —
   so the Railway build is untouched.
3. Verify the two builds produce different artefacts from the same commit and that the Railway build
   still emits its `headers` (the export build cannot — see the spike result).

**Cost:** contained, no repo refactor. **Risk:** Next has no first-class route exclusion, so this is
a tree-mutating build step — the failure mode is a shell build that silently includes a stale route,
or a Railway build that runs against a mutated tree. Make the script idempotent and fail loudly.

### Option B — split into two apps in a workspace

`shell/` (exported) and `api/` (server), sharing `lib/` as a workspace package.

1. Create the pnpm workspace and move `lib/` into a shared package; both apps import from it.
2. Move `app/api` + `middleware.ts` into `api/`, everything else into `shell/`.
3. Railway builds and deploys `api/`; Capacitor bundles `shell/out`.

**Cost:** large — this is the repo refactor, and it touches every import path. **Benefit:** the
cleanest end state and the one that matches the stated app-native direction; no build-time tree
mutation, each app's config is honest about what it is. If Phase 3 is genuinely architecture rather
than an optimisation, this is the option that reflects that.

### Option C — abandon `output: 'export'`

Keep the Next server; have Capacitor bundle only a minimal boot page.

**Cost:** low. **Benefit:** low — the shell JS still comes from the network, which is most of what
Phase 3 exists to remove. Recorded for completeness; it is the option to pick only if A and B are
both judged too expensive, and it should be called a deferral rather than a delivery.

**Recommendation, not a decision:** B if Phase 3 is being built as architecture (the stated reason),
A if the goal is to get a bundled shell onto the device soon and revisit. Do not pick unilaterally.

### Task 4c — the original steps, valid once the split exists

Whichever option lands, these still apply to the **shell** build:

- [ ] Set the API base. The shell has no server, so every relative `/api/...` call needs an absolute
  base pointing at Railway — through **one** constant, not per-call-site edits.
- [ ] Remove `server.url` / `cleartext` from `capacitor.config.ts:8-11` so the WebView loads the
  bundled assets instead of `https://trainingai-production.up.railway.app`.
- [ ] `npx cap sync android` and confirm the built assets are copied into the Android project.
- [ ] **Deliver the CSP another way.** `next.config.ts`'s `connect-src` begins `'self'`, and once the
  shell is served from `capacitor://localhost` the Railway origin is no longer `'self'` and must be
  listed explicitly. **But the spike found `headers` doesn't apply to an exported build at all**, so
  editing `connect-src` in `next.config.ts` will not take effect on the shell — it needs a
  `<meta http-equiv="Content-Security-Policy">` tag or the native layer. Getting this wrong is silent
  in the sandbox and total on device: every API call CSP-blocked.

---

## Task 5: Reconcile the service worker's two jobs

`CLAUDE.md` (Canonical Runtime) is explicit: **do not delete the PWA plumbing.** The SW is both the
offline cold-start path *and* the push-notification transport.

- [ ] **Step 1: Recognise that Task 4 makes half of it redundant**

Once the shell is bundled, the SW no longer provides offline cold start — the APK does. **Its
push-transport role remains and must keep working.**

- [ ] **Step 2: Verify push registration under the new origin**

A service worker registered from `capacitor://localhost` is a different registration than one from
the Railway origin, and the existing push subscription **will not carry over**. Confirm whether the
push subscription must be re-established on first launch after upgrade, and if so, handle it — an
existing user silently losing notifications is a regression, not a migration detail.

- [ ] **Step 3: Do not remove `app/manifest.ts` or the SW**

Even if it looks dead. `CLAUDE.md` names full PWA removal as part of a separate, unscoped endgame.

---

## Note: post-split update delivery has no OTA path (not actioned, optional)

Found 2026-07-31, reviewing the plan after Task 4's first attempt (#952) broke production and was
reverted (#962). Today, shell/UI changes ship through Railway into the WebView with **no APK
rebuild** — only genuine Kotlin/native changes need one, and those are rare. Once the shell is
bundled into the APK (this plan's whole point), that flips: **every shell/UI change becomes a
Kotlin-style change**, needing a new `assembleDebug`/`assembleRelease` build, a new GitHub Release
(the existing `android.yml` workflow already does this — rolling `apk-latest` release), and the
user manually tapping through the existing in-app update card
(`components/more/update-check-card.tsx` → `/api/download-apk` → sideload install prompt). That
card already exists and would keep working post-split with zero changes — but there is no silent
OTA/hot-swap path (no `capacitor-updater` or equivalent) anywhere in the codebase or this plan, so
every shell change costs a full manual reinstall instead of a background bundle swap.

**Not being actioned now** — rebuilds aren't frequent enough today to justify the cost. Worth
doing *if it turns out to be low-effort* (e.g. adding `capacitor-updater` to hot-swap the exported
shell bundle without a full APK reinstall) once Phase 3's split has landed and this plan's own
update cadence is felt in practice.

---

## Task 6: Device verification — the only real gate

- [ ] **Step 1: Build and install the APK**

Run: `npx cap sync android && cd android && ./gradlew assembleDebug`
Note: **Kotlin/Gradle builds cannot run in the cloud sandbox** (no Android SDK, Gradle download is
proxy-blocked). This step requires the owner's machine.

- [ ] **Step 2: Cold start**

Force-stop and launch. Expected: the shell paints with **no network wait**; data fills in after.
This is the entire point of the project — if it doesn't, stop and diagnose before proceeding.

- [ ] **Step 3: Run the full smoke checklist**

Run through `docs/device-smoke-checklist.md` in full. The origin change touches everything:
auth, offline-first local SQLite, the outbox, push, and safe-area insets.

- [ ] **Step 4: Verify offline cold start specifically**

Airplane mode, force-stop, launch. Expected: the app opens and shows local-store data. A bundled
shell should make this *better* than today, so a regression here means Task 5 went wrong.

---

## Rollback

`capacitor.config.ts` restoring `server.url` reverts the runtime to remote-loading in one line — but
**only if Task 3's client-side auth still works against the server-rendered pages**, which it will,
since client-side session reading is valid in both modes. Tasks 1–3 are therefore safe to land
incrementally and independently; **Task 4 is the irreversible-feeling step** and should be its own
PR with its own device verification.

## What this plan does NOT do

- It does not make data faster. Every `/api/*` call still crosses to Singapore. Phase 4 covers that.
- It does not remove the service worker or the PWA manifest.
- It does not change the 194 API routes' logic — only how they authenticate the caller.
