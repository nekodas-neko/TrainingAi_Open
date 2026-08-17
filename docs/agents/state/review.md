# Review — baton

**Updated:** 2026-08-17 · **By:** the first sweep to run under this role · **Q band:** 450–499 (next free: **456**)

## Now

**PR #16 carries this sweep.** If it is still open, merge it once green — docs-only, no ceremony.

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

| Q | | What |
|---|---|---|
| **Q-450** | 🔴 | `/activity` reached without a type: Start works, Finish works, **Save silently discards the activity**. Two in-app paths reach it. |
| **Q-451** | 🔴 | A no-program account's **Workout tab** is a ~1,400 px empty card with a **dead "Start Workout" button**. |
| Q-452 | 🟠 | The AI insight card runs an LLM over a prompt of literal `"no data"` strings; tells a day-one user their inactivity is a "significant gap". |
| Q-453 | 🟡 | `/api/training-stress` silently answers for *today* on a malformed `date`; its ten siblings all 400. |
| Q-454 | 🟡 | Two routes validate params before checking auth (**no data leaks** — verified). |
| Q-455 | 🟡 | An unhandled throw returns a **bodiless 500**, not a JSON error. |

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

- **The write surface.** Only `GET` was swept. The same anonymous / degenerate-input matrix against
  POST/PATCH/DELETE is the obvious next step, and `CLAUDE.md`'s write-path ownership rules
  (affected-row counts, raw bodies into `.set()`, client-supplied ids on tables with no `user_id`)
  say exactly what to look for.
- **The offline path and the error path.** Two of the four failure cells named in the role brief were
  **not** exercised — everything here ran against a healthy server with a live network.
- **Production data.** This sweep used only the fresh local seed, so it says nothing about prod drift.
  `POST /api/admin/db-query` over the `claude_ro` views was **not** used at all.
- **Q-452's siblings.** Only the four `AiInsightCard` sections were checked; `weekly-digest` and the
  coach were not checked for the same absent-vs-zero confusion. *Sibling-surface sweep* applies.

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
