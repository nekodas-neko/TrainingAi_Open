# Handoff — 2026-08-04 · Observability, navigation measurement, and a measure-first queue drain

_Domain: `platform` (also touches `app-shell`, `devices`, `sleep`, `workouts`) · Branch: `fix/prescription-generation-race` · PR: #1071 (open, CI running)_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/platform/README.md`, then `docs/implementation-backlog.md` (the queue).
> This file covers only what *this* session did and what it leaves behind.

## Goal

Work the queue top-down without owner input, and — where an item's premise was an assumption —
measure it before writing code. Four items turned out to be different from how they were filed,
which is the main value of the session.

## Current status

- **Build/test:** full suite 3100/3100, typecheck and lint clean on every merged PR. `pnpm dev`
  exercised for the routes that changed (`/api/version`, `/api/download-apk`, the error hook).
- **Device-verified:** **no.** Nothing this session was checked on the S25. The nav-timing
  instrument, the update card's three states, and the hydration bug all need the device.
- **Production is v1.256.3**; #1071 takes it to 1.256.4.

## What shipped

| PR | What | Note |
|---|---|---|
| #1062 | Prefetch four navigation targets that had none | effect still unmeasured |
| #1063 | **Navigation-timing instrument** — per-tap `urlMs`/`paintMs`/`settleMs` + `rscCount` (0 = route was warm), read from More → Admin → Device data capture | verified end-to-end in real Chromium |
| #1064 | **Q-56** — step rollup can no longer date frames into the future | nearest-anchor + future guard |
| #1065 | **Q-59** — update banner tracks the APK, not the app version | + `package.json` out of the Android path gate |
| #1066 | `nativeVersionStatus` on `/api/version` | diagnosed the live failure below |
| #1067 | **Q-58 part 1** — `onRequestError` for the 80 routes with no `catch` | verified by firing it |
| #1068 | Owner decisions + **Q-71 measurement** | see "Key decisions" |
| #1069 | **Q-58 part 2** — 21 routes that caught their own 500 silently | Q-58 complete: 30/31 |
| #1070 | **First read of `error_events`** — 3 findings, 1 live | see "Open questions" |
| #1071 | **Q-54** — prescription + status in one write | open |

## Deliberately NOT done

- **Q-71** (nearest-anchor for sleep/HR/temperature). Its entry set the threshold itself: seconds →
  ship, minutes → owner's eye. **Measured: median 304 s, p95 579 s, max 609 s.** Minutes. Left
  queued *with the numbers attached* rather than shipped or re-asked from scratch.
- **Q-72 / Q-3b** (Sleep Score re-tuning). The data gate is cleared and the analysis is done —
  re-tuning a number the owner reads every morning is a product judgement, not a fit.
- **Q-27** (docs migration) — **closed without doing either half.** The domain READMEs already carry
  **55 links** to the loose root docs, which *is* the subject-based view the migration wanted;
  moving the files breaks all 55 for colocation nothing navigates by.
- **Q-51** (split `session-select-content.tsx`, 1453 lines). A large refactor of the daily
  workout-entry screen, verifiable only by typecheck, with no user-visible benefit — poor
  risk/reward while a live hydration bug is open on the same shell.
- **Q-42** (readiness composite). Its entry implies the formula needs extracting;
  `computeReadinessComposite` is **already** shared. The real work is extracting ~250 lines of data
  gathering from a 636-line route — larger and riskier than filed. Re-scope before starting.

## Key decisions (with rationale)

- **The `.onnx` files must never enter the public repo.** They are the *decrypted, extracted* form of
  Oura's own `oura_models.apk` (`docs/oura-models/readable/BUNDLE-README.md`), i.e. another company's
  proprietary weights. This was originally framed to the owner as a repo-size question — wrong
  framing, and it would have led to a bad call. The CI bucket-fetch step must land **before** the
  files leave the tree: 14 test files read them off disk.
- **Q-54 fixed by atomicity, not by dedup.** Broadening the dedup key would re-couple the duration
  picker to the auto-fire generation, which `skipCooldown: true` exists to avoid. Last-writer-wins
  was never the defect; a row describing *neither* run was.
- **`package.json` out of the Android path gate.** Every release bumps its version, so the APK was
  being rebuilt and republished on *literally every merge* (last six checked: all version-only).
  Dependency changes are covered by `pnpm-lock.yaml`, which a version bump never touches.
- **Error reporting: two disjoint populations.** A global hook sees only what *escapes*; a route that
  catches its own error needs an explicit call. The filed figure of "189 edits" counted ~76 routes
  with no 500 path at all.

## Gotchas / what did NOT work

- **`/api/admin/db-query` truncates at 1000 rows.** `ORDER BY anchor_ds ASC` over the anchors table
  silently drops the *newest* rows — exactly the data an anchor analysis needs. Prefer aggregating
  in SQL over pulling rows.
- **Deriving a ring `ds` from a stored `sleep_start`** by inverting the newest-anchor formula uses
  the broken conversion to build its own input. It reported deltas of *4.7 days*. Convert real
  stored `ring_timestamp_ds` values both ways instead.
- **Joining `day_checkins` to `sleep_sessions` on date fans out** — 37 rows from 32 ratings, because
  five dates carry a nap as a second session. Take the longest session per date.
- **An early-return runtime guard in `instrumentation.ts` does not let webpack prune the dynamic
  import** — the file's own header comment says so, and I made exactly that mistake; the build
  pulled `pg` into the edge bundle and failed on `fs`. Use `if (=== 'nodejs') { await import(...) }`.
- **Next treats an underscore-prefixed folder as private** — a test route at `app/api/__errortest__/`
  404s and looks like a broken hook.
- **"Insert after the last import line" breaks on a multi-line `import { … } from`** — it lands
  inside the braces. Typecheck catches it instantly.
- **Two hydration leads chased and killed** (see Open questions) — do not re-chase them.

## Files to look at

- `lib/perf/nav-timing.ts` + `nav-timing-recorder.ts` — the navigation instrument. Watches
  `location.href` on animation frames rather than `usePathname`, because `/workout` →
  `/workout?session=…` changes only the query and a pathname hook never fires for the app's busiest
  navigation.
- `lib/observability/request-error.ts` + `instrumentation.ts` — the global error hook.
- `lib/github-release.ts` — the one `apk-latest` lookup, shared by `/api/version` and
  `/api/download-apk`.
- `docs/reviews/2026-08-04-error-events-first-read.md` — evidence for the live hydration bug.

## Open questions / blockers

**Waiting on the owner:**
1. **`GITHUB_RELEASES_TOKEN` is unset in Railway** — confirmed via `"nativeVersionStatus":
   "unconfigured"` on production. The update card can't work **and More → Download APK has been
   failing all along**, same token. Unnecessary once the repo is public.
2. **Navigation capture** — Reset nav timings → use the app → Run all → Copy. Unblocks Q-70 and
   settles whether #1062 helped.
3. **Q-72** — whether to re-tune the Sleep Score, and what a bad night should score.
4. **Q-71** — whether a ~5 min shift to future sleep boundaries is acceptable.

**Live bug, no owner input needed but not solvable here — Q-73:**
React #418 (*text content does not match server-rendered HTML*) on the home screen, **283
occurrences, 12 on 2026-08-03, no downward trend**. `/health` and `/more` stopped 2026-07-14; home
did not. Ruled out: the pre-hydration theme script (writes classes, not text) and the session-165
lazy-initializer rule (not violated anywhere). **Two leads killed:** `toLocaleString()` on the steps
number (this Node is full-icu, returns `1,234` same as Chromium) and DOM nesting (no table markup
anywhere on the home path). Did not reproduce on `pnpm dev` via Playwright as the seeded user. `/`
renders `TabPage`, which mounts **all five tabs at once**, so static search covers five tabs blind.
**Next step is the un-minified error captured on the device.**

## Pickup prompt

```
Work on TrainingAI. Start by reading, in order: projectOverview.md (status + Known Issues),
docs/domains/platform/README.md, then
docs/handoff-2026-08-04-platform-observability-and-measure-first-drain.md, then
docs/implementation-backlog.md.

First action: check whether PR #1071 (fix/prescription-generation-race) merged. If it is still
open and green, merge it; if it failed, read the job logs and fix.

Then take Q-73 — a live React hydration mismatch on the home screen, 283 occurrences and still
happening daily. Evidence and two already-killed leads are in
docs/reviews/2026-08-04-error-events-first-read.md; do not re-chase toLocaleString or DOM nesting,
both are disproven. It did not reproduce on pnpm dev as the seeded user, so the decisive step is
the un-minified error captured on the device — ask the owner for it rather than guessing across
the five tabs that `/` mounts simultaneously.

Constraints you would otherwise rediscover:
- Nothing this session was verified on the S25. Device-only paths stay unverified.
- GITHUB_RELEASES_TOKEN is NOT set in Railway. /api/version reports
  "nativeVersionStatus":"unconfigured", the update card cannot work, and More → Download APK has
  been failing. Only the owner can set it; it becomes unnecessary once the repo is public.
- Q-71 and Q-72 are measured and waiting on an owner decision, not on more analysis. Do not
  re-measure them; the numbers are in their backlog entries.
- /api/admin/db-query truncates at 1000 rows — aggregate in SQL rather than pulling rows, and
  never ORDER BY ASC when you need the newest.
- The .onnx model files are Oura's extracted proprietary weights and must never enter the public
  repo. The CI bucket-fetch step has to land before they leave the tree (14 tests read them off
  disk).
- Merge policy: feature branch, CI green, merge without asking except for destructive changes.
```
