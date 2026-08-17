# Review agent — baton

_Rewritten in full at the end of every Review session. Not appended. Last rewrite: **2026-08-17**._

> **Read this first, then [`../README.md`](../README.md) §1–§3, then `projectOverview.md`, then
> `CLAUDE.md`, then the last two or three write-ups in `docs/reviews/`.**

## Where things stand

The first session under this role ran on **2026-08-17**. Neither `docs/agents/README.md` nor this
file existed, so it started with no baton and wrote both on the way out. Everything below is from
that one session — treat the "recently run" list as short because it *is* short, not because the repo
is under-reviewed. It is heavily reviewed; see the table further down.

**Q band: 450–499. Used so far: Q-450…Q-455. Next free: Q-456.** Take numbers directly from the band;
do not read or write the backlog's next-free pointer. Claim against the queue file **and every open
PR** — an unmerged PR is invisible to the pointer and that has already caused a real collision.

## Lens run on 2026-08-17 — the failure cells, exercised live

Write-up: [`../../reviews/2026-08-17-failure-cells-running-the-app.md`](../../reviews/2026-08-17-failure-cells-running-the-app.md).
Merged docs-only. Nothing was fixed.

**Why this lens:** the six-round comprehensive review that closed the same morning
(`docs/handoff-2026-08-17-cross-comprehensive-review-six-rounds.md`) states its own limit — *"Nothing
in six rounds was rendered — no device, emulator, browser, or `pnpm dev` run."* Thirty-eight backlog
entries, none of which could have come from watching the app behave. Running it was the whole edge,
and it paid immediately: **the two worst findings are both dead primary actions that source-reading
had walked past repeatedly.**

**Filed (6):**

| Q | Severity | What |
|---|---|---|
| **Q-450** | 🔴 | `/activity` reached without a type: Start works, Finish works, **Save silently discards the activity**. Two in-app paths reach it. |
| **Q-451** | 🔴 | A no-program account's **Workout tab** is a ~1,400 px empty card with a **dead "Start Workout" button**. |
| Q-452 | 🟠 | The AI insight card runs an LLM over a prompt of literal `"no data"` strings; tells a day-one user their inactivity is a "significant gap". |
| Q-453 | 🟡 | `/api/training-stress` silently answers for *today* on a malformed `date`; its ten siblings all 400. |
| Q-454 | 🟡 | Two routes validate params before checking auth (no data leaks — verified). |
| Q-455 | 🟡 | An unhandled throw returns a **bodiless 500**, not a JSON error. |

**Came back CLEAN — do not re-cover these without a reason:**

1. **The `[-/]` date-separator class.** All 11 date-taking routes accept **both** separators, hit
   live. The bug class `CLAUDE.md` documents at length is not currently present.
2. **The unauthenticated surface.** 122 GET routes with no cookie: 114 exact 401, 3 admin 403, 2
   deliberately public, 3 filed as Q-454. **No route served user data unauthenticated.**
3. **A zero-data account against all 122 GET routes.** Exactly **one** route differs from the seeded
   user, and it is a clean `404 {"error":"No active program"}`.
4. **Crash-freedom and empty states.** 51 renders (30 seeded + 21 zero-data): zero uncaught page
   errors, zero console errors, zero failing `/api/` responses. Empty states are genuinely well built
   **apart from Q-451** — `/program`, `/health/day`, `/running`, `/cardio`, `/session-explain` all
   say something useful.

## Deliberately left for next time

- **The device.** Everything above is the **web** build — `getLocalStore()` returns null, so every
  offline-first domain took its web fallback and the canonical runtime was never touched. No
  safe-area, Samsung-WebView, native-plugin or native-SQLite claim was made or can be made from here.
- **Production data.** This sweep used only the fresh local seed, so it says nothing about prod drift.
  `POST /api/admin/db-query` over the `claude_ro` views was **not** used at all — and note its two
  stacked floors (row-scoped to one user, 30-day prune) before writing any count from it.
- **POST/PATCH/DELETE routes.** Only `GET` was swept. The whole write surface is unexamined by this
  lens — the same anonymous/degenerate-input matrix against mutating routes is the obvious next step,
  and `CLAUDE.md`'s write-path ownership rules say what to look for.
- **The offline path**, one of the four failure cells named in the role brief, was **not** exercised.
  Neither was the error path under a *failing* server (everything here was a healthy server).
- **Q-452's siblings.** Only the four `AiInsightCard` sections were checked. Other AI surfaces
  (`weekly-digest`, the coach) were not checked for the same absent-vs-zero confusion.

## Lenses with recent coverage elsewhere — check before repeating

From `docs/reviews/`, all source-reading unless noted:

- **2026-08-15/16, six rounds (Q-271…Q-308)** — the five scoring pillars measured against production;
  six previously-unused lenses; every remaining pillar for model soundness (**heart-rate and body came
  back clean**); the 1RM/volume gaps; a multi-user load test **actually run**; four deferred
  measurements. Read `docs/handoff-2026-08-17-cross-comprehensive-review-six-rounds.md` before
  picking anything model-shaped.
- **2026-08-16** — goal-invalidation audit (one cache group audited; **the others are not**, and
  Q-263 is queued for exactly that).
- **2026-08-14** — UI / flow / information-architecture, with a reachability count for all 39 page
  routes.
- **2026-08-08** — multi-user and empty-state review, and the first review that **ran** the app.
- **2026-08-07** — full-app deep review, 53 findings.

## How this session worked, if it helps

Dev server on the seeded local DB (`pnpm db:local`, then `env -u DATABASE_URL -u DATABASE_SSL pnpm dev`
— both vars are pre-set to production in the container and Next will not let `.env.local` override
them). Signed in with `curl` via `/api/auth/csrf` → `/api/auth/callback/credentials`
(`test@local.dev` / `testpass123`) to get a cookie jar for the API sweeps. A second zero-data account
was made by copying the seeded user's `password_hash` and then setting `is_active=true` — **without
that update, sign-in 302s and leaves a null session**, which looks like a broken login and is the
invite gate working correctly. Screens were driven with temporary specs in `e2e/` using the repo's own
Playwright config (S25 viewport, sandbox Chromium), run against the already-running server with
`E2E_BASE_URL=http://localhost:3000`, and **deleted before committing**. First-visit renders are
confounded by Turbopack compile time — both blank screens were re-checked warm before being believed.
