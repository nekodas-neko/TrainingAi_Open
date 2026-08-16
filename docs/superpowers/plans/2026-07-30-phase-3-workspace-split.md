# Phase 3 Task 4 — Workspace Split (Option B: two apps in a workspace)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or
> superpowers:executing-plans to work this task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Context.** `docs/superpowers/plans/2026-07-28-native-feel-phase-3-bundled-shell.md` Task 4 recorded
the owner's decision (2026-07-30): option B, split into `shell/` (statically exported, bundled into
the APK) and `api/` (stays on Railway), sharing `lib/` via a pnpm workspace package. That doc scoped
the decision and costed the three options; it did not write the restructuring steps. This plan does.

**Do not start this until Task 3 (move auth client-side) is far enough along that you understand
its shape** — Task 3's client session hook and default-deny route gate are what `shell/`'s root
layout replaces `middleware.ts` with once `output: 'export'` is flipped. This plan's Steps 1–2 (the
workspace + app split) do **not** require Task 3 to be finished first — `api/` keeps serving
`middleware.ts` + cookie/bearer auth exactly as today throughout this plan. Only the final Task 4c
step (flip `output: 'export'`, drop `server.url`) needs Task 3's client-side gate to be live in
`shell/`, because static export runs no middleware at all. **Sequence: this plan's Steps 1–3 → Task
3 (client auth, confirm-first) → this plan's Step 4 (Task 4c, flip the export flag).**

**Blast radius, measured 2026-07-30:** 317 files import from `@/lib/*`; 195 API routes; 40 page
routes. This is the largest single refactor on the roadmap — the cost the Task 4 decision already
accepted. Every step below is scoped to be committable and buildable on its own.

---

## Step 0: Inventory the trust boundary inside `lib/` before moving anything

**This is the step a fast pnpm-workspace tutorial skips, and it's the one that actually matters
here.** `lib/` today mixes three things that must NOT all land in one shared package:

1. **Genuinely isomorphic pure logic** — safe in both a statically-exported client bundle and a
   Node server: `lib/health/*`, `lib/workout/*` formula modules, `lib/1rm.ts`, `lib/date-utils.ts`,
   `lib/cache-ttl.ts`, `lib/sync/mutation-schema.ts` / `mutation-domains.ts`, zod schemas, `types/*`.
2. **Server-only** — imports `pg`, Drizzle, `bcrypt`, `onnxruntime-node`, or reads server env vars
   directly: `lib/data/postgres/**`, `auth.ts`/`auth.config.ts`, `lib/oura-models/**` (constants +
   the ONNX inference paths). These must never be reachable from `shell/`'s bundle — Next's static
   export doesn't error on an accidental server import the way `pnpm build` did in Task 2's spike;
   it can silently bundle a huge Node dependency into client JS, or fail opaquely deep in the build.
3. **Client/native-only** — Capacitor plugin calls, the local SQLite store, Zustand stores:
   `lib/local-store/**`, `lib/oura-ble/**` (the plugin bridge half, not the pure decoders),
   `lib/native/**`, `lib/stores/**`, `lib/sqlite/**`. These must never be reachable from `api/`'s
   bundle — `api/` runs in Node on Railway with no WebView, no Capacitor bridge.

- [ ] **Produce the actual map before writing any config.** Run a dependency-graph tool (or a
  scripted `grep -rl "from '@/lib` per top-level `lib/` subdirectory, cross-checked against which
  of those subdirectories import `pg`/`bcrypt`/Capacitor plugins) to classify every `lib/`
  subdirectory into isomorphic / server-only / client-only. Treat the three-bucket list above as a
  starting hypothesis, not the answer — some files (e.g. `lib/oura-ble/decode.ts`, already noted in
  the offline-first architecture doc as shared between the server rollup and the on-device one) are
  isomorphic today specifically *because* an earlier initiative (the Oura on-device program) already
  did this exact separation work for that one directory. Follow that precedent.

---

## Step 1: Create the pnpm workspace and extract the isomorphic shared package

**Files:**
- New: `pnpm-workspace.yaml` at repo root
- New: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Move: the isomorphic subset from Step 0 into `packages/shared/src/`

- [ ] **Add `pnpm-workspace.yaml`:**
  ```yaml
  packages:
    - 'packages/*'
    - 'shell'
    - 'api'
  ```
- [ ] **Create `packages/shared`** with its own `package.json` (name e.g. `@trainingai/shared`,
  `"type": "module"`) and a `tsconfig.json` that does NOT include DOM lib assumptions the server
  side can't use, nor Node-only assumptions the client side can't use — keep it to `ES2017`/`esnext`
  matching the root `tsconfig.json`'s current `compilerOptions`.
- [ ] **Move the isomorphic files identified in Step 0**, preserving their internal relative
  imports. Update every one of the 317 `@/lib/*` import sites application-wide to import from
  `@trainingai/shared` for anything that moved — **this is the step that touches the most files**,
  so do it with a scripted codemod (find/replace on the import specifier, not by hand) and let
  `tsc --noEmit` be the completeness check (a missed site is a compile error, not a silent bug).
- [ ] **The rest of `lib/` (server-only + client-only) stays at the repo root for now** — Step 2
  moves it into `api/`/`shell/` respectively. Don't do both moves in one commit.

Run: `pnpm install` (regenerates the workspace lockfile), `pnpm exec tsc --noEmit`, `pnpm lint`,
`npx vitest run`.
Expected: clean. The app is still a single Next app at repo root at this point — this step only
proves the shared package extracts and every import site was updated. **Commit here.** This step is
independently revertible (git revert the commit; nothing else in the app changed shape).

- [ ] **Update the two CI custom-rule scripts that scan by path.**
  `scripts/check-push-mutations.js` and `scripts/check-reconcile.js` grep specific files
  (`lib/data/postgres/adapter.ts`, the local-store backend) for invariants CLAUDE.md documents as
  load-bearing. If any file either script scans moved into `packages/shared`, update the script's
  path in the **same commit** — a silently-stopped-running CI custom rule is worse than an
  explicit failure, and this is exactly the kind of drift those rules exist to prevent elsewhere.

---

## Step 2: Split into `shell/` and `api/`

**Files:**
- New: `shell/` (package.json, next.config.ts, tsconfig.json) containing everything under today's
  `app/` except `app/api/`, plus `components/`, `hooks/`, non-server `lib/` remainder, `public/`
- New: `api/` (package.json, next.config.ts, tsconfig.json) containing `app/api/`, `middleware.ts`,
  the server-only `lib/` remainder (`lib/data/postgres/**`, `auth.ts`, `auth.config.ts`,
  `lib/oura-models/**`), `drizzle.config.ts`, `lib/data/postgres/migrations/`

- [ ] **Move `app/api/**` + `middleware.ts` + server-only `lib/` into `api/app/api/`** (or
  `api/`'s own top-level `app/` — pick whichever keeps `find app/api -name route.ts` style tooling
  working with a path prefix, and say which in the PR). `api/` is still a normal (non-exported)
  Next.js server app at this point — same as today, just relocated. It keeps serving all 195 routes
  with `await auth()` exactly as now.
- [ ] **Move everything else into `shell/`** — all 40 page routes, `components/`, `hooks/`,
  client-only `lib/` remainder, `public/`, `app/layout.tsx`, `app/manifest.ts`, the service worker
  route. `shell/` is *also* still a normal Next server app at this point, **not yet exported** —
  this step is a pure file relocation, not the `output: 'export'` flip. Both apps still call
  `@trainingai/shared` for the isomorphic subset.
- [ ] **`shell/`'s own `/api/*` calls need an absolute base URL immediately**, even before the
  export flip, because after this step `shell/` no longer has its own `app/api/` to relatively
  route to. Introduce the **one constant** (`apiUrl()` or similar, per Task 4c's existing
  instruction — don't duplicate that work, just land it now instead of at the end) pointing at
  wherever `api/` is currently deployed, and grep every relative `fetch('/api/...')` call site to
  go through it.
- [ ] **Two Railway services for the transition period.** `api/` deploys to the existing Railway
  service (same env vars, same DB connection). `shell/` needs its **own** temporary Railway deploy
  (or a preview environment) so it keeps working as a normal server-rendered app during Steps 2–3,
  before the export flip removes the need for `shell/` to be served at all. Do not skip standing
  this up — there is no way to verify `shell/` builds and serves correctly otherwise, since `pnpm
  build` alone doesn't catch a cross-app relative-import mistake the way a route boundary would.
- [ ] **`middleware.ts` in `api/` needs re-scoping.** Today's matcher guards *page* routes (36 of
  40) — those pages no longer live in `api/`. Once `api/` only serves `app/api/**`, decide whether
  `middleware.ts` moves to gating API routes directly (most already call `await auth()` per-route —
  check whether that makes middleware redundant there) or is deleted from `api/` entirely in favor
  of per-route checks. **Do not leave a middleware matcher that references page paths which no
  longer exist in this app** — it's dead config, not a redundant safety net, once the paths it
  names aren't served here.

Run (per app): `pnpm --filter shell exec tsc --noEmit`, `pnpm --filter shell lint`,
`pnpm --filter api exec tsc --noEmit`, `pnpm --filter api lint`, `pnpm --filter api test` (DB-backed
tests need `DATABASE_URL`), `pnpm --filter shell build && pnpm --filter api build`.
Expected: both build clean as ordinary (non-exported) Next apps. Deploy both, smoke-test `shell/`
end to end against `pnpm dev`-equivalent behaviour (sign-in, a guarded page, a few API round trips)
before moving on.

**Commit here, as its own PR.** This is the large one — review it as a pure relocation diff where
possible (file moves + import-path updates), flagging any line that changed *behavior* rather than
*location* for extra scrutiny.

---

## Step 3: Per-app config hygiene

- [ ] Each app gets its **own** `next.config.ts`, not a shared one branching on an env flag (the
  Task 4 decision explicitly rejected Option A's tree-mutating/env-flag approach as a recurring
  hazard — don't reintroduce the same shape one level up).
- [ ] `api/`'s `next.config.ts` keeps the existing CSP/security headers (`next.config.ts`'s current
  `securityHeaders` array) — nothing changes there, since `api/` isn't exported and `headers` still
  applies to it.
- [ ] `shell/`'s `next.config.ts` does **not** carry `serverExternalPackages: ['onnxruntime-node']`
  or any other server-only config — it has no server routes needing it.
- [ ] Test config: `vitest.config.ts` needs a per-package (or workspace-aware) setup so
  `packages/shared`'s own tests, `api/`'s DB-backed tests, and any `shell/`-side tests all run under
  `npx vitest run` from the repo root, matching how CI invokes it today. Verify CI's `ci.yml` steps
  (Lint, Tests, Build, Custom Rules, Migration Check) still resolve correctly against the new
  layout — this may need updates to `.github/workflows/ci.yml`'s working-directory / script
  invocations, in the same PR as Step 2's move (not a follow-up).
- [ ] `drizzle.config.ts` and the migrations directory stay under `api/` — nothing in `shell/`
  touches Postgres directly.

Run: the full CI gate locally (`pnpm lint`, `pnpm exec tsc --noEmit` per package,
`node scripts/check-reconcile.js`, `node scripts/check-push-mutations.js`, `node
scripts/check-doc-links.js`, `npx vitest run`) before presenting for merge.

---

## Step 4: Task 4c — flip the export flag (only after Task 3 lands in `shell/`)

**Do not start this step until Task 3 (move auth client-side) has landed in `shell/` and its
default-deny client gate is live** — static export runs no middleware, so `shell/` must already be
protecting its own routes client-side before `output: 'export'` is turned on, or every guarded page
becomes briefly public. This is the exact hazard Task 2b flagged for the original (unsplit) plan;
it applies identically here, just scoped to `shell/` alone now instead of the whole app.

This step is the original Task 4c checklist from
`docs/superpowers/plans/2026-07-28-native-feel-phase-3-bundled-shell.md`, unchanged, now scoped to
`shell/` specifically:

- [ ] Add `output: 'export'` to `shell/next.config.ts`.
- [ ] Confirm the API base constant (Step 2) points at `api/`'s permanent Railway URL.
- [ ] Remove `server.url` / `cleartext` from `capacitor.config.ts` so the WebView loads the bundled
  `shell/out` assets instead of the Railway URL.
- [ ] `npx cap sync android` and confirm the built assets are copied into the Android project.
- [ ] **Deliver the CSP another way.** `headers` doesn't apply to an exported build — ship a
  `<meta http-equiv="Content-Security-Policy">` tag in `shell/app/layout.tsx` (or the native layer),
  covering the same directives `api/`'s CSP already documents, with `connect-src` widened to
  include `api/`'s origin explicitly (it's no longer `'self'` once served from
  `capacitor://localhost`).
- [ ] Retire the temporary `shell/` Railway deploy from Step 2 — it's no longer needed once the APK
  bundles the export output directly. Decide whether to keep a web-only build of `shell/` (served
  dynamically, unexported) as the `pnpm dev` QA surface the Canonical Runtime section of CLAUDE.md
  calls for, or whether `pnpm dev` against the unexported `shell/` app already covers that need
  without a separate deploy.

**Device gate (Task 6 in the original plan, unchanged):** build the APK, cold-start with no
network, confirm the shell paints instantly and data fills in after. Run the full
`docs/device-smoke-checklist.md`. This step is the irreversible-feeling one — its own PR, its own
device verification, per the original plan's Rollback section.

---

## What this plan does NOT do

- It does not implement Task 3 (client-side auth) — that plan already exists in
  `2026-07-28-native-feel-phase-3-bundled-shell.md` and is sequenced around this one (before Step 4,
  otherwise unconstrained relative to Steps 1–3).
- It does not touch the Oura on-device program (D0–D7) — that is a separate, already-planned,
  already-in-progress initiative or the `api/` Postgres rollup, tracked independently.
- It does not change any of the 195 API routes' request/response behavior — only where their files
  live and which package they import shared code from.
