# APK as canonical target — reducing the dual-path tax

> **Status: draft for review.** This is an approach/analysis doc, not a finalised
> task-by-task plan. A reviewing agent should turn the chosen workstreams below
> into concrete tasks + a backlog entry (per the backlog protocol). It intentionally
> stops short of prescribing exact diffs so the reviewer can scope and sequence.

## Why this exists

The app ships as both a PWA (browser / installed web app) and an APK (Capacitor
WebView). The question that prompted this: *is there value in dropping the PWA and
going APK-only, focusing on the local DB and syncing only what's needed to Railway?*

The investigation found the framing needs correcting before any work is scoped, and
that the **worthwhile** near-term move is not deleting the PWA but **treating the
APK as the canonical runtime to stop paying the "dual-path tax"** — the recurring
"web passes, device broken" bug class.

## Architectural findings (the facts that shape the decision)

1. **The APK is a WebView pointing at the Railway URL, not a bundled native app.**
   `capacitor.config.ts` sets `server.url = https://trainingai-production.up.railway.app`
   with no `webDir`. The APK downloads the same shell + API the PWA does. So the APK
   is **not** more independent of Railway than the PWA today; dropping the PWA does
   not reduce Railway coupling or unlock "sync only the necessary info."

2. **The service worker is load-bearing for the APK, not PWA-only fluff.**
   Because the WebView loads remotely, the SW (`app/sw.js/route.ts` +
   `public/sw-template.js`) is what lets the APK **cold-start offline** (it caches
   the shell + `_next/static` on first visit). It is also the **push-notification
   transport** (`lib/push-client.ts` → `pushManager`), which delivers notifications
   inside the APK WebView. Deleting the SW without a native replacement breaks
   offline launch *and* push **on the device**.

3. **The local SQLite store is already device-only and already source-of-truth on
   the APK.** `getLocalStore` returns `null` unless `isSQLiteAvailable()` (which
   requires `Capacitor.isNativePlatform()`, `lib/sqlite/sqlite-service.ts:16-21`).
   There is no additional "local DB focus" to unlock by dropping the PWA — that work
   already exists.

4. **The dual-path tax is real and is the actual cost worth attacking.** Every
   offline-first domain reasons about two runtimes: the native local-first path and
   the web online-only fallback (`getLocalStore` null → `cachedFetch`-only reads).
   The worst incidents come from the **web API route and the `pushMutations` branch
   in `lib/data/postgres/adapter.ts` drifting** (CLAUDE.md offline-sync incidents
   #47, #74, #82).

## Decision being proposed

**Adopt the APK on the S25 as the single canonical/supported runtime, and treat the
web build purely as a dev/QA surface — as a policy shift plus one incremental
refactor. Do NOT delete the PWA (manifest / service worker) now.**

Rationale: the SW and manifest are entangled with offline launch and push on the
device; deleting them is a regression, not a simplification, while the APK still
loads remotely. Full PWA removal only makes sense as part of a *much* larger,
*later* project (bundle the shell into the APK + migrate push to native FCM), which
also costs the current "UI deploys via Railway with no APK rebuild" convenience —
out of scope here.

## The key constraint that shapes every workstream

**Do not delete the web fallback branches.** The web sandbox has no local store at
all, so the online-only fallback is what makes `pnpm dev` render — and `pnpm dev` is
the pre-merge test gate (CLAUDE.md). The goal is not to *remove* the second path but
to make it **so thin it cannot drift** from the device path.

## Proposed workstreams (for the reviewer to turn into tasks)

### WS1 — Doctrine (CLAUDE.md) — highest leverage, near-zero risk
Write the canonical-target rule into CLAUDE.md so it stops being re-litigated per
change. Suggested substance:
- The S25 APK is the only supported runtime; the web build exists solely as a
  dev/QA surface.
- When behaviour must diverge, device wins; never add product features that only
  make sense on web.
- The online-only read fallback exists only so `pnpm dev` renders — it must never
  carry logic the device path lacks.

### WS2 — Thin, logic-free web fallbacks
Standardise every web fallback as a pure read-through / hydration (fetch → render),
with all defaults, validation, and write semantics living in one shared place.
Reference pattern already in the codebase: supplements in
`app/nutrition/nutrition-content.tsx` (local-first read, API as fallback only). A
fallback that holds no logic structurally cannot diverge from the device path.
Reviewer to decide: audit-and-list now vs. fix-on-touch.

### WS3 — One write function per domain (the only real code work)
Converge the web API route and the `pushMutations` branch onto a single shared
function per domain (via `lib/data/repository.ts`), so write semantics can't drift.
This is already a stated CLAUDE.md goal ("prefer one shared repo function per
domain") and helps both runtimes — no downside. Best done incrementally: converge a
domain's two write paths before adding to them. Reviewer to decide scope: a
prioritised list of the highest-drift-risk domains vs. a blanket sweep.

### WS4 — Testing gate: device checklist is the merge gate
Formalise that green `pnpm dev` is necessary but never sufficient; the gate for any
offline-first domain is the on-device smoke run (`docs/device-smoke-checklist.md`).
Mostly already practice — this writes it as the rule.

### WS5 — (Endgame, later, out of scope here) Converge the runtimes for real
If the dual path should be *deleted* rather than neutered, run a browser wasm SQLite
so `isSQLiteAvailable()` is true on web too — then there is one local-first path on
both surfaces and the fallback disappears. This is a project in itself; note it as a
successor, do not scope it here.

## Explicitly out of scope
- Deleting `app/manifest.ts`, the service worker, or the install affordance.
- Bundling the shell into the APK / dropping `server.url`.
- Migrating push to native FCM (`@capacitor/push-notifications`).
- Anything that reduces Railway coupling (that is the separate "bundle the shell"
  project, worthwhile only once UI iteration slows).

## Open questions for the reviewing agent
1. WS2/WS3 sequencing: one upfront audit PR that lists every drifting domain, or
   pure fix-on-touch with only the doctrine + checklist landing now?
2. Should WS3 ship a CI custom-rule that flags a `pushMutations` branch whose domain
   lacks a shared repo function (mirroring the Batch J enforcement pattern)?
3. Is any web-only affordance (install prompt, homescreen manifest polish) worth
   *keeping* for cross-device quick access, or does canonical-target mean freezing
   all web-only UI work?
