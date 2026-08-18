# Review Agent 📖 — baton

> **Successor sessions are titled `Review Agent 📖`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-18 · **By:** six sweeps (2026-08-17 ×2, 2026-08-18 ×4) — **all eleven pillars now covered** · **Q band:** 450–499 (next free: **469**)

## Now

Six sweeps have run under this role. **Every one of the eleven pillars has now been reviewed at
least once**, at the owner's request to work through the sections:

| Pillar | Lens applied | Findings |
|---|---|---|
| `workouts` | write path cross-user + live drive | Q-460…Q-462 |
| `nutrition` · `cardio` · `activity` | writes cross-user + app-wide not-found probe | Q-463 |
| `sleep` · `readiness` · `heart-rate` · `body` · `devices` | ingest auth, value validation, schema strictness | Q-464, Q-465 |
| `app-shell` · `platform` | failure cells, repo-migration architecture, **the Coach write path** | Q-450…Q-459, Q-467, Q-468 |

**Still open by design, and the obvious next lenses:** the **device runtime** (nothing in any sweep
left the web build — every offline-first domain took its web fallback), **production data**
(`claude_ro` was never queried in any of the six), the **offline and error paths** (everything ran
against a healthy server on a live network), and the secret-gated `health-connect/ingest` validation.

### Sweep 6 — the AI Coach's write path (2026-08-18) — the first review ever to cover it

Owner picked this from a shortlist of remaining angles. Write-up:
[`docs/reviews/2026-08-18-coach-apply-path.md`](../../reviews/2026-08-18-coach-apply-path.md).

**Why it was the right pick:** the Coach appears in eight prior review docs and five backlog entries,
all about cost/latency/model-ID/navigation. **No review doc mentioned `coach_changes`,
`applyCoachChange` or undo.** It is the only place an LLM-initiated flow writes to the data deciding
what the user is told to lift (five domains).

**Filed — Q-467, Q-468**, both at the top of the queue:

- **Q-467** — the whole undo subsystem is built (route + window guard + five `undo()` handlers +
  `captureBefore` + `undone_at` + history styling for undone changes) and **nothing calls it**. Every
  client Coach fetch was enumerated; the undo path is in none. ⚠️ **Not** the known "no user-facing
  entry point" note — that is phase 1's *apply* path, since wired.
- **Q-468** — `undo` writes `beforeState` back with no drift check, while `apply` has one. Apply A,
  apply B, undo A → the row holds A's "before" while the history still shows B as in effect; undo both
  → the programme ends on a value the user never chose. **Do Q-468 with or before Q-467.**

**CLEAN, and worth protecting:** the apply path is the best-built write path I have read in this repo
— model never in the write path (documented, with why the SDK's binary tool-approval was rejected),
`fieldsMatchDomain` blocking cross-domain field aiming, ownership by join, Zod whitelist quoting
`CLAUDE.md` rule (b), admin gate on shared-catalogue creation, merged-away rows unselectable, no
half-applied patches. **Double-apply refused with a 409 drift report; cross-user undo 404s.**

**Not covered:** only `session_exercise` driven end to end (other four handlers read, not run);
`/api/coach/preview` unprobed; the model was never in the loop, so nothing here says whether it
*proposes* good patches — that is a separate lens.

### Sweep 5 — the ingest surface: sleep, readiness, heart-rate, body, devices (2026-08-18)

Write-up: [`docs/reviews/2026-08-18-ingest-and-input-validation.md`](../../reviews/2026-08-18-ingest-and-input-validation.md).
These five pillars barely expose `[id]` write routes — they are read-and-derive, so the write-surface
lens does not reach them and this one does.

**Filed — Q-464** (70 schema files, only **6** `.strict()`; demonstrated as a silent wrong-day write on
`body-metadata` — **but `sync/push` must not be made strict carelessly**, older-APK payloads may carry
unnamed fields) and **Q-465** (`day-checkin` creates a row from `{}`; **consequence unproven and the
entry says so**).

**CLEAN, and the more useful half:** **no ingest route accepts a `userId` from the body** (all ten
session- or secret-gated, two behind `requireAdmin`), and value validation rejected every
physiologically impossible probe with nothing reaching Postgres — HR `-50`/`99999`, mood `999`/`-5`,
weight `99999`/`-40`, malformed scale hex. The weight errors even name the bound violated.

**Also filed from this run, not from the probe — Q-466:** CI re-downloads the Playwright browser on
every E2E run with no cache; observed stalling **three times on 2026-08-18**, each costing a cancel-and-re-run
on a required check. If E2E sits on `Install Chromium` while `Run pnpm e2e` is still `pending`, that is
the download, not the specs — cancel and re-run rather than diagnosing the specs.

**Not covered:** `health-connect/ingest` was read but **not called** (secret-gated, no secret here), and
the Oura BLE sample routes were not exercised with real frames.

### Sweep 4 — nutrition/cardio/activity writes, and the not-found answer app-wide (2026-08-18)

Owner asked for section-by-section coverage. Write-up:
[`docs/reviews/2026-08-18-write-surface-not-found.md`](../../reviews/2026-08-18-write-surface-not-found.md).

**Filed — Q-463** (sits directly above Q-462, the instance it generalises): the "row does not exist"
answer is inconsistent across 33 dynamic write endpoints, and **five return a 500** (four with an
empty body). One cause — 16 bare `throw new Error('… not found')` in the repository layer with no
route mapping. Matters because a 5xx makes the sync client retry what can never succeed, and every
refused request writes a stack trace into `error_events`.

**CLEAN:** cross-user protection holds across nutrition/cardio/activity too (nine probes, owner's rows
re-read, control for each) — so **all four write pillars are now probed and none leaked**. And the
seven idempotent `DELETE`s returning 200/204 for an absent row are **defensible, deliberately not
filed** — the reasoning is in the review so it is not re-litigated.

**Section coverage so far.** The write surface is swept for workouts, nutrition, cardio, activity,
and (via the app-wide probe) body/devices/platform/app-shell. **`sleep`, `readiness` and `heart-rate`
barely expose dynamic write routes at all** — they are read-and-derive pillars whose writes arrive
through ingest and sync, so they need a different lens, not this one. That is the next sweep.

### Sweep 3 — the workout write path, driven live and probed cross-user (2026-08-18)

Owner-requested: review the workout logic and screens. Took the gap this baton named — **the write
surface**, which every prior sweep had left (`GET` only). Write-up:
[`docs/reviews/2026-08-18-workout-write-path.md`](../../reviews/2026-08-18-workout-write-path.md).

**Filed — Q-460 … Q-462.** Q-460/461 upper-mid (above Q-353), Q-462 low.

| Q | | What |
|---|---|---|
| Q-460 | 🟠 | `POST /api/workout-sessions/rpe` returns `{"success":true}` for a write that matched nothing; `pushMutations` then `processed++`s it and **drops the outbox mutation**. Rule (a). **Lane A.** |
| Q-461 | 🟠 | `Start Set 2`'s infinite `animate-bounce` blocks Playwright's stability check → **the core write path cannot be E2E-driven past set 1**. Testability only; a human is unaffected. **Lane B.** |
| Q-462 | 🟡 | An ownership refusal on `/api/log-exercise` surfaces as a 500. Block is correct; reporting is not. |

**CLEAN — and the headline is a clean result:**

1. **Cross-user write protection holds across the whole workout surface.** A second live account
   against the owner's real ids: `workout-entry` PATCH/DELETE → 404, `workout-sessions` DELETE → 404,
   `log-exercise` → refused, `prescribe` → 404; owner's rows re-read and unchanged.
2. **The outbox cannot be wedged** by one bad workout mutation (per-mutation `try/catch`).
3. **The flow runs end to end** on web — zero uncaught page errors, zero failing `/api/` responses.
4. **Two near-misses cleared:** the "▲ +2.00 kg" 1RM delta is exact (stored PR is 98, not the 97.5
   header, which is the previous session's estimate); the warm-up "92% = 70 kg" is a fixed target
   percentage with plate-rounded weight, by design.

**Method lesson worth keeping: run a control for every ownership probe.** An early `PATCH` returned
`400 Invalid body`, which reads exactly like protection and was actually my payload breaching the
schema's `max(500)`. The same-call-as-owner control is what exposed it. Also: the UI drive produced no
`POST /api/log-exercise` and that is **not** a bug — the POST fires when an *exercise* completes, not
per set.

### Sweeps 1–2 (2026-08-17, both merged: #16, #38)

**Four of the thirteen findings have already been implemented** by the Implementation lanes — Q-450 (#31),
Q-451 (#33), Q-452 (#39), Q-457 (#44) — so a Q number missing from the backlog queue is finished, not
dropped. Nine remain open: Q-453, Q-454, Q-455, Q-456, Q-458, Q-459, Q-460, Q-461, Q-462.

### Sweep 2 — the public/private boundary as an architectural property

Owner-requested: review the architecture specifically with respect to the repo migration. Write-up:
[`docs/reviews/2026-08-17-repo-migration-architecture.md`](../../reviews/2026-08-17-repo-migration-architecture.md).

**Filed — Q-456 … Q-459.** Q-456/457 upper-mid (above Q-313), Q-458/459 low.
**Status column checked against `main` on 2026-08-17 — do not trust it after that without re-checking.**

| Q | | What | Status |
|---|---|---|---|
| Q-456 | 🟠 | The owner's production user ID is baked into **18 committed migrations**, and `CLAUDE.md`'s "re-run the generator into a new migration" rule re-publishes it on every schema change. Not a credential; fix the generator, not the files. **Lane A.** | **open** |
| Q-457 | 🟠 | `lib/github-release.ts:24` defaulted `APK_RELEASE_REPO` to the **archived private repo**. | ✅ Lane B, #44 |
| Q-458 | 🟡 | `.env.example` wrong both ways — 8 dead keys incl. `TOKEN_ENC_KEY` (names a security property the app lacks) and 5 Oura **Cloud** keys; 4 real vars undeclared. | **open** |
| Q-459 | 🟡 | The rolling `apk-latest` release is delete-then-recreate → the public download URL 404s on every native merge. | **open** |

**CLEAN — six areas, including the two that mattered most:**

1. **No credentials published.** No GitHub/Google/OpenAI-shaped keys, no PEM private keys, no `.env`
   (only `.env.example`, values all empty), no keystores, no tracked build output.
2. **No third-party personal data.** The only real emails belong to bundled library authors.
3. **The public-repo CI posture is correct.** All three workflows use `pull_request`, **not
   `pull_request_target`**; `ci.yml` uses no secrets; the APK publish is gated on `push` so forks
   cannot reach it.
4. **A fresh clone's tests genuinely work** — synthetic constants are committed and `vitest.config.ts`
   falls back to them when the real `MANIFEST.json` is absent. That is the path CI takes every run.
5. **`AWS_*`/`STORAGE_*` is a deliberate alias chain, not two schemes.** Checked and cleared — a
   near-miss recorded so it is not re-raised.
6. **`private-paths.json` is well built,** down to deliberately non-specific descriptions so the
   inventory is not a map to what it protects.

**Noted, not filed:** `private-paths.json` protects a third party's IP; nothing plays that role for
this project's own users' identifiers. Q-456 reached a public repo because no gate was looking.
Second list, or widen the first? A design decision, not a review finding.

### Sweep 1 — the failure cells, exercised live (PR #16, merged)

**PR #16 carried this sweep and is merged.**

> **A method warning worth more than the finding it came from.** This session spent a long stretch
> convinced CI had stalled: Lint/Custom Rules/Migration Check went green in under a minute while
> Tests/Build/E2E sat `in_progress`, and repeated polls kept showing no movement. It looked like a
> 70-minute hang and was written up as one. It was not. **The sandbox's backgrounded `sleep` calls
> are throttled and batched** — several fired at once, long after they should have — so the polls
> were minutes apart in wall-clock terms, not the hour they felt like. `date -u` settled it: five
> minutes had passed, and CI was running perfectly normally (the sibling PR completed all six checks
> in 4.5 minutes). **Check `date -u` before concluding anything is slow or hung here.** Elapsed time
> inferred from your own polling cadence is not evidence.

**Lens run: the failure cells, exercised live** — the error path, the empty state, the first-run
path, the entry point reached out of order. Write-up:
[`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](../../reviews/2026-08-17-failure-cells-running-the-app.md).

Why that lens: the six-round comprehensive review that closed the same morning states its own limit —
*"Nothing in six rounds was rendered — no device, emulator, browser, or `pnpm dev` run."* Thirty-eight
backlog entries, none of which could have come from watching the app behave. Running it was the whole
edge, and it paid immediately: **the two worst findings are dead primary actions that source-reading
had walked past repeatedly.**

**Filed — Q-450 … Q-455** (Q-450/451 sit directly below Q-310 at the top of the queue):

| Q | | What | Status |
|---|---|---|---|
| **Q-450** | 🔴 | `/activity` reached without a type: Start works, Finish works, **Save silently discards the activity**. Two in-app paths reach it. | ✅ #31 |
| **Q-451** | 🔴 | A no-program account's **Workout tab** is a ~1,400 px empty card with a **dead "Start Workout" button**. | ✅ #33 |
| Q-452 | 🟠 | The AI insight card runs an LLM over a prompt of literal `"no data"` strings; tells a day-one user their inactivity is a "significant gap". | ✅ #39 |
| Q-453 | 🟡 | `/api/training-stress` silently answers for *today* on a malformed `date`; its ten siblings all 400. | **open** |
| Q-454 | 🟡 | Two routes validate params before checking auth (**no data leaks** — verified). | **open** |
| Q-455 | 🟡 | An unhandled throw returns a **bodiless 500**, not a JSON error. | **open** |

**Came back CLEAN — a real result; do not re-cover without a reason:**

1. **The `[-/]` date-separator class.** All 11 date-taking routes accept **both** separators, hit
   live. The bug class `CLAUDE.md` documents at length is not currently present.
2. **The unauthenticated surface.** 122 GET routes with no cookie: **114 exact 401**, 3 admin 403, 2
   deliberately public, 3 filed as Q-454. **No route served user data unauthenticated.**
3. **A zero-data account across those same 122 routes.** Exactly **one** differs from the seeded
   user, and it is a clean `404 {"error":"No active program"}`.
4. **Crash-freedom and empty states.** 51 renders (30 seeded + 21 zero-data): zero uncaught page
   errors, zero console errors, zero failing `/api/` responses. Empty states are genuinely well built
   **apart from Q-451**.

## Next

Pick a lens nothing has covered recently. What this sweep deliberately left, roughly in order of how
much it is worth:

- **The rest of the write surface.** Sweep 3 covered the **workout** mutations only. Still unprobed:
  the program / phase-set / progression-style / template routes, and every non-workout domain. And
  rule (b) — **raw request bodies passed into Drizzle `.set()`** — was never systematically audited in
  any sweep; it is the one of the three ownership rules with no evidence behind it.
- **The offline path and the error path.** Two of the four failure cells named in the role brief were
  **not** exercised — everything here ran against a healthy server with a live network.
- **Production data.** This sweep used only the fresh local seed, so it says nothing about prod drift.
  `POST /api/admin/db-query` over the `claude_ro` views was **not** used at all.
- **Q-452's siblings.** Only the four `AiInsightCard` sections were checked; `weekly-digest` and the
  coach were not checked for the same absent-vs-zero confusion. *Sibling-surface sweep* applies.

From sweep 2 (the repo migration):

- **A clean clone, actually built.** Sweep 2 read the tree and argued the fresh-clone claims from the
  committed fixtures and CI's behaviour. Nobody has done `git clone` into an empty container and run
  `pnpm install && pnpm build && pnpm test`. That is the one check that would settle `NOTICE`'s claim
  outright, and Q-313 (no `next build` gate in the publish dry-run) is the reason it is worth doing.
- **The archived private repo was not examined.** The public repo's single-snapshot history is what
  bounds the exposure question here; that reasoning does not transfer to the archive.
- **Secret detection was pattern-based.** Strong evidence of absence for conventional formats, not
  proof for a bespoke or high-entropy-but-unpatterned credential.

## Blocked

Nothing. But note the standing ceiling: **the device.** Everything this role can run is the **web**
build — `getLocalStore()` returns null, so every offline-first domain takes its web fallback and the
canonical runtime is never touched. No safe-area, Samsung-WebView, native-plugin or native-SQLite
finding can originate here, and every write-up must say so.

## Claimed paths

None. This role's PRs are docs-only.

## Do not re-litigate

- The role's authority limits and the lane contract are settled in
  [`docs/agents/README.md`](../README.md). Read it rather than re-deciding it.
- Take Q numbers from the band above, not from the backlog's next-free pointer — and claim against
  **every open PR** too, since the pointer cannot see an unmerged one (that has already caused a real
  collision, Q-297).
- **Queue position is priority; Q number is not.** Q-450 above Q-310 was deliberate.

## Method notes, so the next session does not re-derive them

- `pnpm db:local`, then `env -u DATABASE_URL -u DATABASE_SSL pnpm dev`. **Both vars are pre-set to
  production in the container and Next will not let `.env.local` override an already-set
  `process.env` var** — without the `env -u`, the dev server silently tries production and fails.
- API sweeps: sign in with `curl` via `/api/auth/csrf` → `/api/auth/callback/credentials`
  (`test@local.dev` / `testpass123`) into a cookie jar.
- A zero-data account is worth the two minutes: copy the seeded user's `password_hash`, then
  `update users set is_active=true`. **Without that update, sign-in 302s and leaves a null session** —
  which reads like a broken login and is actually the invite gate working correctly.
- Screens: temporary specs in `e2e/` using the repo's own Playwright config (S25 viewport, sandbox
  Chromium), run against the already-running server with `E2E_BASE_URL=http://localhost:3000`, and
  **deleted before committing**. Capture console errors, `pageerror`, failing `/api/` responses and
  rendered text length — text length is what surfaced both blank screens.
- **First-visit renders are confounded by Turbopack compile time.** Anything that looks sparse must be
  re-checked warm before it is believed; both blank screens here were, and both reproduced.
