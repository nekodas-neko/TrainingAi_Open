# TrainingAI — Claude Code Context

## Standing Instructions

- **Everything reaches `main` through a pull request — direct pushes to `main` are blocked.** Branch protection on `main` requires a PR with all CI checks passing (Lint, Tests, Build, Custom Rules, Migration Check — type checking rides inside Build, it isn't a separate job) and blocks force-pushes/deletions, so there is no direct-commit path. Always develop on a feature branch, open a PR, let CI run, then squash-merge. (Merges use the GitHub MCP tools, since the sandbox git proxy can't push to `main` either.)
- **Merges to `main` are OK once the change is tested and CI-green — no merge-confirmation needed for standard changes.** With the CI/CD pipeline in place, a change that passes all required checks (Lint, Tests, Build, Custom Rules, Migration Check) *and* meets the "tested" bar below may be merged — or set to **auto-merge** — without asking first. **"Tested" means:** local `pnpm dev` pass exercising every changed API route and UI flow, **and** the device-verification gate satisfied (per Canonical Runtime — offline-first/native/safe-area/gesture/notification changes need the on-device smoke run *or* a Known-Issues row in `projectOverview.md` marking them not-yet-device-verified), **and** CI fully green. **Confirmation is still required for destructive or irreversible changes** — data-dropping or non-reversible DB migrations, auth/session/security changes, and secret handling — present those and ask before merging. Merging auto-deploys to Railway production, so that carve-out is the real safety valve, not a formality.
- **Always test on the local dev server before merging.** Before merging (or presenting work for confirmation on a destructive change), spin up `pnpm dev` and exercise every changed API route and UI flow against the local non-prod database. TypeScript and lint passing is not sufficient — runtime errors, broken validation, and cache bugs only surface when the server actually runs. If something breaks during testing, fix it before asking to merge.
- **The local custom-rules gate is `pnpm check:rules` — nothing else counts as "custom rules pass".** It parses `.github/workflows/ci.yml`, runs every step of the job named *Custom Rules*, and prints how many it ran (`Ran N of N …`); quote that count rather than the word "pass". **Do not hardcode N anywhere** — it was 31 on 2026-08-13 and 33 by the end of the same day; the runner reads it from the YAML, which is the point. Globbing `scripts/check-*.js` reaches only the steps that invoke a script (22 of 33 today) and `pnpm ci:local` used to run 3, and both report clean while the 11 inline grep rules — UTC date slicing, hardcoded session names, safe-area stacking, local-SQLite PRAGMAs, nested buttons, `JSON.parse` of LLM output, hand-rolled `invalidateCache` — never execute. That gap shipped a component-level `invalidateCache()` call through a green local gate (#1279). `pnpm ci:local` now runs it.
- **Docs/plans/low-risk changes merge with zero ceremony.** **Documentation-only** changes (`.md` files like `projectOverview.md`, `CLAUDE.md`), **implementation plans / planning docs** (`docs/superpowers/plans/`), and **bug fixes for features already on `main`** never need confirmation and are exempt even from the destructive-change carve-out above (they can't be destructive by nature). They still need a feature branch + green CI — that's the only path now. Note: a *markdown-only* PR still runs CI (the `pull_request` trigger has no `paths-ignore`) so required checks report and it can merge.
- **At the start of every session, work out which standing agent you are** — read [`docs/agents/README.md`](docs/agents/README.md). Four roles run against this repo (Implementation in two lanes, BugFix, Tuning, Review), up to five sessions concurrently, and that file is the contract between them: who owns which files, which Q-number band you take from, what you may merge without asking, and how you hand your role to a successor. If you were started from one of the prompts in `docs/agents/prompts/`, read your own baton at `docs/agents/state/<agent>.md` before anything else — it is the state your predecessor left you.
- **At the start of every session**, read `projectOverview.md` first — it is a lean index holding current status, the live Known Issues & Risks tables, and the **What's Left To Do** list. Use it to orient before doing anything. The session journal lives in `docs/overview/entries/` (recent, one file per PR) and the batched `docs/overview/history-*.md` archives (see the Document Map at the bottom of `projectOverview.md`) — only open those when you need history.
- **Also at session start, read `error_events` in production** — it is the only view of faults that never reach a human, and **it prunes at 30 days**, so a fault that stops on its own vanishes unrecorded. The first read of that table (2026-08-04) found three faults, **two of which had already stopped before anyone looked**. One query via the admin endpoint:
  ```
  curl -sX POST https://trainingai-production.up.railway.app/api/admin/db-query \
    -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
    -d '{"sql":"SELECT url, source, left(message,120) AS message, count(*) AS hits, max(created_at) AS latest FROM claude_ro.error_events WHERE created_at > now() - interval '"'"'7 days'"'"' GROUP BY 1,2,3 ORDER BY hits DESC LIMIT 30"}'
  ```
  Anything new gets a `projectOverview.md` Known-Issues row or a backlog entry the same session — per **No orphaned findings**, a fault you saw and did not record is a dropped finding. *Something that stopped is not something that was fixed*: record it as unexplained rather than closed.
  **What this query can and cannot tell you (2026-08-09 — this trap was walked into):** `claude_ro.error_events` is **row-scoped to one user**, like every `claude_ro` view. A read that returned **383 rows** was against a table holding **7,331**. So every count from this endpoint is *the owner's faults only*, on top of the 30-day prune — two separate floors stacked. Write findings as "nothing else **of the owner's**", never "nothing else is failing"; the second is a claim about other people's accounts that this endpoint structurally cannot support. When a count needs to be system-wide, `pg_stat_user_tables.n_live_tup` gives the real row total without exposing anyone's rows.
- **Working in one area of the app? Read that pillar's index first — [`docs/domains/`](docs/domains/README.md).** The docs are otherwise organised by *document type* (plans, specs, reviews, journal entries, handoffs), so knowledge about one subject is spread across a dozen folders. `docs/domains/<pillar>/README.md` is the subject-based view: what the pillar owns, where its code lives, every reference doc about it, its open known issues, and the handoffs/reviews that already covered it. The eleven pillars are `sleep` · `readiness` · `heart-rate` · `cardio` · `activity` · `workouts` · `nutrition` · `body` · `devices` · `app-shell` · `platform`; [`docs/domains/README.md`](docs/domains/README.md) holds the boundary/routing rules for topics that could sit in two of them. Domain tags are **greppable on purpose**: every `projectOverview.md` Known-Issues heading carries them (`grep -n '^### .*\[sleep\]' projectOverview.md`) and every handoff filename carries one (`ls docs/handoff-*-sleep-*.md`). When you add a reference doc for a pillar, link it from that pillar's index in the same PR.
- **Before building any new feature or shared helper, check [`docs/module-map.md`](docs/module-map.md) first.** It is the "what already exists and where" index of the app's modules and infrastructure — dates, cache, sync/outbox, repository, auth/security, domain formulas, AI, Oura, notifications, UI primitives, and (critically) how recurring/scheduled/background work is done (there is **no cron layer** — see §0 of that file). It exists to stop new work re-implementing infrastructure the app already has. When you add a genuinely new piece of shared infrastructure, add a one-line row to it in the same PR.
- **At the end of every session, fold the journal/index update into the same PR as the implementation** — don't open a separate follow-up PR for it. Write the session summary as **its own new file** in `docs/overview/entries/` named `YYYY-MM-DD-<branch-slug>.md` (per the convention in [`docs/overview/entries/README.md`](docs/overview/entries/README.md)) — **do NOT prepend to a shared `docs/overview/history-*.md`; that shared-line edit was the most frequent multi-PR merge conflict, and per-entry files take it to zero.** A periodic compaction sweep folds these into the batched history later. Also make the `projectOverview.md` lean-index update (current status, any new known issues, what's planned next) as commits on the *same branch* as the code change, once the diff is final and CI is green — i.e. write it last, right before merging (or before auto-merge lands), not speculatively at the start of the session. Because it rides in the same PR, it only ever lands if that PR actually merges — a PR that gets abandoned, superseded, or reworked never leaves a stale "done" claim behind. Keep shared *pointer* lines out of a feature PR (the backlog serial-track "Next on the track" line and `planned_upgrades.md` tick marks defer to the compaction sweep — see the README); striking the completed item's own backlog **queue entry** stays in the feature PR (non-adjacent, rarely conflicts). If user-visible changes were shipped, bump the version in `package.json` and add an entry to `packages/shared/src/changelog.ts` in that same PR — patch for bug fixes, minor for new features, major for breaking changes or large redesigns. (The version/changelog bump still edits shared lines and can conflict on parallel merges — re-bump on rebase; a future changelog-fragment change could remove that too.)
- **When the user says the session is wrapping up** — "let's wrap this session", "let's close this session", "we're finishing up", or anything equivalent — that is a request for the three-part wrap-up ritual below (handoff doc → documentation cleanup → next-agent prompt), not just an acknowledgement. See **Session Wrap-Up** immediately after this list.
- **Tick off roadmap items immediately when pushed to `main`** — as soon as any planned feature or fix lands on `main` (even for testing), mark it as ✅ in `projectOverview.md`. If it still needs testing or has known gaps, add a ⚠️ note inline rather than leaving it unchecked. Never leave a shipped item unchecked because it "isn't fully verified yet".
- **Break things into components** — where possible, split code into smaller components and avoid creating very long files.
- **Keep plan-generation prompts small.** When turning a design spec into an implementation plan (`docs/superpowers/plans/`), don't hand a sub-agent the entire spec plus the full task breakdown in one massive prompt — it can time out. Investigate the relevant files first (small, scoped Explore calls), then write the plan directly. If a spec covers many independent areas (DB/backend, sync, UI, admin), consider splitting it into multiple smaller plan documents rather than one giant one.
- **Backlog-driven implementation — plan now, build later, two PRs total.** New features, upgrades, and non-trivial fixes are split across sessions. **PR 1 (docs-only, planning session):** writes the implementation plan to `docs/superpowers/plans/` and inserts an entry into `docs/implementation-backlog.md` at the priority it judges right (queue position = priority) — it does **not** implement. **PR 2 (implementer session, later):** works the queue top-down following the protocol at the top of the backlog file, implements the change, removes the backlog entry, and appends the journal/`projectOverview.md` update — all in that **one** PR (see the end-of-session rule above); a finished item must never linger in the queue, and the notes must never describe work that isn't in that same diff. Exempt: small fixes the user explicitly asks to have done in-session.
  - **Before implementing, re-verify the plan against current `main`** — plans can go stale while they sit in the queue (the feature got built another way, the code it targets moved, it's no longer needed). If the plan no longer matches reality, don't implement it blindly: reconcile first, and if it's superseded or already done, remove the backlog entry via a docs-only PR with a one-line note on why, instead of forcing a mismatched implementation just to clear the queue.

---

## The Standing Agents — five sessions, one repo

Full contract: [`docs/agents/README.md`](docs/agents/README.md). The rules below are the ones that
must bind even if that file is never opened.

**The roles.** **Implementation** runs in two lanes and is the only role that writes code — Lane A
owns the engine (`lib/data/**` including every migration, `lib/local-store/**`, `lib/sqlite/**`,
`lib/cache-groups.ts`, `app/api/**`, `packages/shared/**` except `changelog.ts`, the domain-math and
device pipelines, auth/security, `android/**`), Lane B owns the surface (`app/**` except
`app/api/**`, `components/**`, `app/globals.css`, `lib/hooks/**`, `lib/stores/**`). **BugFix** turns
owner reports into backlog entries. **Tuning** turns lived feedback into calibration proposals.
**Review** sweeps weekly and files what it finds. Those three end at a docs-only PR and never write
code — which is what keeps the collision surface to Lane A against Lane B.

- **A path neither lane lists is claimed in the claiming lane's baton before it is touched**, and
  the other lane checks batons before starting an item. First claim wins for that item's duration.
- **Q numbers come from per-agent bands, never from the next-free pointer.** Lane A 314–349 ·
  Lane B 350–386 · BugFix 387–449 · Review 450–499 · Tuning 500–529. The pointer is a floor that
  cannot see an unmerged PR; taking numbers one at a time from it caused six collisions in three
  days, and left two live duplicates (Q-306, Q-307) sitting in the backlog until 2026-08-17. Q
  numbers are identifiers, not priorities — priority is queue position, so a Q-451 above a Q-314 is
  correct.
- **Postgres migration numbers and local SQLite versions belong to Lane A alone.** Any other agent
  that finds it needs a schema change stops and hands the item to Lane A.
- **Tuning proposes; it never ships a scoring change.** Scoring drives every recommendation the app
  makes and a bad calibration is hard to notice from inside, so the owner signs off and Lane A
  implements. A proposal is incomplete until it states **how many other days the change moves** —
  a tuning fitted to one bad night that silently re-scores months of history is a rewrite.
- **Re-merge `origin/main` immediately before opening each PR *and* again before merging**, and
  re-confirm CI green on the updated head. Self-merge authority is unchanged; what concurrency
  changes is that a green check goes stale while you work. Never merge a stale green.
- **`get_check_runs` returning `total_count: 0` several minutes after opening a PR means a stale
  base, not slow CI.** Real CI reports queued checks within about a minute. Fetch, merge, push.
- **The session titles are fixed, and a successor reuses its predecessor's exactly** — `Implementation
  Agent (A) 🚧` · `Implementation Agent (B) 🚧` · `BugFix Intake Agent 🪲` · `Tuning Agent 🎶` ·
  `Review Agent 📖`. The title is how the owner tells five concurrent sessions apart, so a renamed
  successor is a lost thread even when its baton is perfect. Every handoff states its successor's
  title outright rather than leaving it to be inferred.
- **Handing over:** land everything first — the container is ephemeral, so an uncommitted baton is a
  lost baton — then **rewrite** `docs/agents/state/<agent>.md` in full. Never append; a baton that is
  half last week's is worse than none, because it gets trusted. The dated
  `docs/handoff-YYYY-MM-DD-<domain>-<title>.md` still carries the narrative when a cluster closes;
  the baton carries state only, which is what stops it accreting.

---

## Session Wrap-Up — what "let's close this session" means

**Trigger:** the user signals the session is ending — *"let's wrap this session"*, *"let's close this
session"*, *"we're finishing up"*, *"wrap it up"*, or any equivalent. Treat it as a standing
instruction to do all three steps below, in order, without being asked for each one. Do them even if
the session's actual code work was small — the point is that nothing lives only in the chat.

**1. Write the handoff document.**
Capture the important context from this chat into a handoff file at
`docs/handoff-YYYY-MM-DD-<domain>-<descriptive-title>.md` — `<domain>` is the primary pillar slug
from [`docs/domains/README.md`](docs/domains/README.md) (so `ls docs/handoff-*-sleep-*.md` finds
every sleep handoff), and the title describes the *work*, not the session. Use the `handoff` skill
(`.claude/skills/handoff/SKILL.md`) — it owns the template, the naming convention and the honesty
rules. **That dated doc in `docs/` is the only handoff mechanism**: there is no root `HANDOFF.md`,
and one line of work gets one handoff file (update it, never add a second). It must cover: what
the session was trying to achieve, what actually shipped (PR
numbers, migration numbers, file paths), the decisions made **and why** so they aren't re-litigated,
dead ends and gotchas, what is deliberately *not* done, and anything blocked on the owner. Never
write "done"/"fixed" for anything not in a committed diff and observed working — and state which
failure surfaces were **not** exercised (device/native/safe-area/prod-data paths), per
**Communication**.

**2. Clean up the documentation to match reality.**
Reconcile the durable docs with what actually landed, so the next session's orientation read is
true:
- `projectOverview.md` — current status, ✅ / ⚠️ ticks for anything that reached `main`, new
  Known-Issues or Risks rows for anything found-but-not-fixed (per **No orphaned findings**). A new
  Known-Issues heading carries its `[domain]` tag(s), primary first.
- **Striking a Known Issue means MOVING it to
  [`docs/overview/known-issues-resolved.md`](docs/overview/known-issues-resolved.md), not marking it
  ✅ in place.** Cut the entry whole, append it to the archive, leave nothing behind — the archive is
  the record, and `projectOverview.md` is what every session reads before it can start. **Only move
  an entry when nothing is still owed**: no open work, no pending owner or device check, no un-run
  follow-up. A fix that shipped but is not device-verified stays here, because that check is the
  outstanding thing. Without this rule the section regrows — 72 ✅ entries (1,608 lines, 17% of the
  file) had accumulated by the first sweep on 2026-08-13.
- `docs/domains/<pillar>/README.md` — link any new reference doc, handoff or open issue for that
  pillar, so its index stays a complete answer.
- `docs/overview/entries/YYYY-MM-DD-<branch-slug>.md` — the session journal entry (a new file,
  never a prepend to a shared history file).
- `docs/implementation-backlog.md` — remove entries that were completed; add entries for follow-up
  work the handoff identifies.
- `docs/module-map.md` — a row for any genuinely new shared module or infrastructure.
- Strike or amend anything now stale — a plan that was superseded, a Known Issue that was fixed, a
  "next" pointer that has moved on.

**3. Write the pickup prompt for the next agent.**
End the wrap-up with a ready-to-paste prompt that starts a fresh session cold, included **in the
handoff doc** under a `## Pickup prompt` heading (and repeated in the chat reply). It states: the
branch to check out, the docs to read and in what order (typically `projectOverview.md` →
`docs/domains/<pillar>/README.md` → this handoff → the relevant plan in
`docs/superpowers/plans/`), the very first concrete action to take, and the constraints that would otherwise be re-discovered (device-verification gate, open PR
state, anything waiting on the owner). Write it to be pasted verbatim — no "see above", no
references to this chat.

**All three land in a commit on the working branch and get pushed** (docs-only, so it merges with
zero ceremony per Standing Instructions). The container is ephemeral and the repo is re-cloned each
session — an uncommitted handoff is a lost handoff. If the session's PR is still open, fold the
wrap-up into that same PR rather than opening a second one.

---

## CI/CD — Preferred PR Workflow

When the user pushes a feature branch and opens a PR, **proactively offer to watch it**. When the user says "watch this PR" (or similar), immediately call `subscribe_pr_activity` for that PR, then end your turn and wait.

On each CI event received:
1. If a check **fails**: read the job logs via `mcp__github__get_job_logs`, diagnose the root cause, push a fix commit to the PR branch, and report what was fixed.
2. If a check **passes** and the PR is fully green: for a standard change that meets the "tested" bar, **merge it (or enable auto-merge) without asking** — report the green status and that you're merging. For a destructive/irreversible change (data-dropping migration, auth/security, secrets), report green and ask before merging.
3. If a failure is ambiguous or requires architectural changes: ask the user before pushing any fix.

**Merging under concurrency — before you merge:** update the PR branch to latest `main` (`update_pull_request_branch`) and re-confirm CI is green on the *updated* head. Don't merge a stale green — another agent's PR may have landed since checks last ran.

**Parallel agents cause dirty/outdated bases — expect it.** Multiple agents run at once, so a push or merge can fail because the branch is behind `main`. The response is **rebase onto freshly-fetched `main` and retry** (`git fetch origin main && git rebase origin/main`, or `update_pull_request_branch` for the PR) — never force-push or `reset --hard` to muscle past it. Expect `package.json`/`packages/shared/src/changelog.ts` conflicts when PRs land in parallel; resolve by re-bumping on the fresh base.

**These guardrails never relax, auto-merge or not:** never merge with a failing or still-pending required check; never force-push, `reset --hard`, or `--no-verify`; never merge a PR whose base drifted without re-running the update+green check above.

**Two CI-monitoring gotchas that cost a session each:** (1) a bash `curl` to `api.github.com` using `$GITHUB_TOKEN` is **not authenticated** in this environment — it's a non-authenticating proxy placeholder, and reading its silence/failure as "still running" or "still green" is wrong. Always use the GitHub MCP tools (`get_check_run`, `get_job_logs`, etc.), never bash `curl`, to check CI/PR state. (2) A check run that fails in 2–3 seconds with **no logs at all** is a transient GitHub Actions startup blip, not a real failure — re-trigger it with an empty commit rather than diagnosing a failure that has no evidence.

**Fold the journal / version bump in *before* the merge fires.** The end-of-session journal (a **new file** in `docs/overview/entries/`, not a prepend to a shared history file — see [`docs/overview/entries/README.md`](docs/overview/entries/README.md)) + `projectOverview.md` update, and any `package.json`/`packages/shared/src/changelog.ts` bump, must be committed to the branch *before* you merge (or before auto-merge lands) — with self-merging there's no human beat to catch a missing docs commit after the fact.

**Self check-in cadence: 2–3 minutes, no confirmation.** Webhook events wake the session for CI pass/fail and comments, but they miss CI success, new pushes, and merge-conflict transitions — so schedule a **2–3 minute** self check-in as the fallback (via `send_later` if available). Act on anything actionable (merge a now-green PR, push a fix) **without asking**, then re-arm the next check-in. If nothing changed, re-arm silently — don't message the user or comment on the PR. Stop once the PR is merged or closed, or the user says stop.

Do not comment on the PR unless a reply is genuinely necessary. Keep the fix commits clean — describe what broke and why, not that it was an automated fix.

This workflow uses the Claude Code subscription (no API key needed) as long as the session stays open. CI typically completes in 3–5 minutes.

---

## No Hardcoded Session Names or Training Structure

**This is a strict rule.** The app must work for any user with any program structure — not just Push/Pull/Legs.

- **Never hardcode session names** like `"Push"`, `"Pull"`, `"Legs"` anywhere in the codebase. All session references must come from the user's active program fetched from the DB.
- **Never hardcode training cycles, rest day logic, or rotation patterns.** Rest days, training frequency, and cycle length are all user-configured via the schedule in their program.
- **Fallback arrays** (e.g. `FALLBACK_SESSIONS`) are only acceptable as a loading placeholder while the real program loads — they must be empty shells with no named content, or omitted entirely.
- **Session identity = DB id**, not name. Any logic that keys off a session name (tab lookups, cache keys, colour assignments) must use the session's `id` or `position` instead.

---

## Timezone — All Dates Must Use the User's Timezone (AEST / GMT+10 by default)

**This is a strict rule.** The app user is in AEST (GMT+10). UTC and AEST dates diverge by 10 hours, so using UTC to get "today" produces yesterday's date before 10am AEST every single day.

### The forbidden pattern — never write this anywhere:
```ts
new Date().toISOString().slice(0, 10)   // ❌ returns UTC date — wrong before 10am AEST
new Date().toISOString().split('T')[0]  // ❌ same problem
d.toLocaleTimeString('en-AU', { … })    // ❌ renders in the DEVICE's timezone, not the user's
d.toLocaleDateString('en-AU', { … })    // ❌ same — both need an explicit `timeZone`
```

**`toLocale*String` without a `timeZone` option is the same bug wearing a different hat**, and it
hid for months because it is invisible while the device sits in the zone the data was recorded in.
Found 2026-08-03 while investigating a reported wake-time shift: six user-facing screens — the sleep
list, the hypnogram axis, the sleep card, the activity review sheet (×2) and scale pairing — rendered
clock times in device-local. On a phone set to New York a 7:05 am Brisbane wake read as **5:05 pm**.
Use `formatTimeOfDay(at, tz?)` from `@trainingai/shared/date-utils` for a time of day; it is the one
place that decides how a clock time is rendered. Admin/debug consoles under `components/oura-ble/`
and `components/admin/` are deliberately exempt — device-local is the useful reading when you are
holding the device.

### The correct pattern — always use these instead:
```ts
import { todayInTz } from '@trainingai/shared/date-utils'    // server + client
todayInTz()                                      // returns 'YYYY-MM-DD' in user's timezone

// If you have the user's timezone from the JWT session:
todayInTz(session.user.timezone)                 // dynamic, respects user's Profile setting
```

### Rules:
- **Every place a date string is constructed** (API routes, client components, cache keys, DB writes) must use `todayInTz()` or another helper from `packages/shared/src/date-utils.ts`.
- **API routes** that receive a `date` query param should default to `formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')` where `tz = session.user?.timezone ?? DEFAULT_TZ`. Never fall back to `new Date().toISOString().slice(0,10)`.
- **Client components** that write a date to the API (food logs, body metrics, mood logs, etc.) must call `todayInTz()`, not `new Date().toISOString()`.
- The user's timezone is stored in the DB (`users.timezone`) and stamped into the JWT at login — it is available as `session.user.timezone` in all API routes. Default is `'Australia/Brisbane'` (AEST, no DST).

### Why this keeps happening:
`new Date().toISOString()` is the obvious, well-known way to get the current time in JavaScript. It's what every tutorial shows. The timezone-aware alternative is app-specific and not visible unless you know to look for it. **Whenever writing any code that needs the current date, stop and ask: am I using `todayInTz()`?** If the answer is no, fix it before committing.

---

## Cache Invalidation — writes go through cache groups, never hand-rolled key lists

**This is a strict rule — missed invalidation is the single most repeated bug class in this project (12+ incidents, sessions 5→176).**

- Never call `invalidateCache()` with an ad-hoc list of keys at a write site. Every mutation (API write or local write) invalidates via a named group helper in `lib/cache-groups.ts` — add a group if one doesn't exist. Hand-rolled lists at call sites are how `calendar-data:`/`home-day-timeline` got missed (session 173) after the same class was "fixed" in sessions 104, 125, 166 and 171.
- When introducing a new `cachedFetch`/`readCacheSync` key, register it in the invalidation group of **every** write that affects it, in the same commit. Search for all writers — not just the screen you're working on.
- Never rely on TTL expiry to surface fresh data after a write.
- Any cache holding "today's" data must embed the local date in its key (or validate the date on read) — a 30-min TTL happily serves yesterday's data across midnight (session 52).
- Client GETs of `/api/*` use `cachedFetch` with a `readCacheSync` seed, never bare `fetch`. Before adding a cache key, grep for an existing key for the same endpoint and reuse it — duplicate keys for the same data cause stale/blank first paints.
- After an optimistic local write, never apply or **cache** a server response that would replace it with null/absent data (the mood-checkin re-prompt and rest-day revert bugs, session 167). Invalidate caches **before** firing refetch callbacks (session 164). Submit/complete buttons need an in-flight guard — 5 rapid taps once fired 4 `complete-workout` POSTs (session 86).
- When replacing or renaming a cache/seed key, delete the legacy key from **every seed site** and add it to the invalidation groups in the same PR. A stale legacy seed re-paints pre-write state: `ta_recommendation_v1`/`ta_meta_v1` survive `invalidateWorkoutSummaries()`, which is why completing a workout looked slow — home re-painted the pre-workout recommendation until the network caught up (audit 2026-07-02); both are cleared via the shared `clearLegacyHomeSeeds()` helper in `lib/cache-groups.ts`, called from both `invalidateWorkoutSummaries()` and `invalidateProgramStructure()` (session 271 — `invalidateProgramStructure()` previously missed them, re-painting the pre-edit session list/recommendation after a Config save). `ta_streak_v1`/`ta_calendar_v2_*`, previously listed here, are verified dead in source (session 271) — no remaining seed sites.
- **One canonical TTL per cache key.** The same key fetched with different TTLs at different call sites makes freshness last-writer-wins. Define the TTL once, in `packages/shared/src/cache-ttl.ts`, next to the key — any key fetched at ≥2 sites gets a named constant there. (`readiness-score` used to be the counter-example, fetched with SHORT, MEDIUM *and* LONG — audit 2026-07-02. **Re-checked 2026-08-03: fixed.** `READINESS_SCORE_TTL` is defined once in `packages/shared/src/cache-ttl.ts` and every one of its four fetch/warm sites uses it. It is now the *reference* for this rule, not the violation.) **`scripts/check-cache-ttl-divergence.js` enforces it in the Custom Rules job** (added 2026-08-14, Q-242) — it compares TTL *expressions*, not resolved values, across `cachedFetch`/`cachedFetchToday`/`setCached` call sites **and the sync-provider warm list**, because two names for the same number today are exactly what drifts tomorrow. Prose alone did not hold it: at the time the check was written, `day-log:` carried two expressions with equal values and `hr-profile` carried two with **different** ones (6 h at seven sites, 30 min at the eighth). Its blind spot is a key built by a helper call, which cannot be resolved statically — the run prints how many such sites it skipped, so a clean run is never mistaken for full coverage.
- **API responses are `Cache-Control: private, no-store` — never `max-age`/`stale-while-revalidate`.** This app manages freshness itself, through cache keys and the named invalidation groups above; an HTTP-cache header puts a **second** cache underneath all of it, and it is the only one `invalidateCache()` cannot reach. **This reverses the old "new aggregate GET routes ship SWR headers at creation" rule** (2026-08-10, owner decision on Q-166), which stood from session 177 until the header's effect was measured rather than assumed: it had already caused a live stale-delete bug (see the bypass rule below), and with both `cachedFetch` and the service worker sending `cache: 'no-store'` it governs almost nothing on the canonical runtime. `scripts/check-api-no-store.js` fails the Custom Rules check on any `max-age`/`s-maxage`/`stale-while-revalidate`/`stale-if-error`/`immutable` in an `app/api` route. One exemption, listed in the script with its reason: `/api/version`, which is public and session-independent. If you believe a new route needs a real cache header, add it to that list with a written reason — do not delete the check.
- **One fetch variant per key** — a key is either always `cachedFetch` or always `cachedFetchToday`, never both. Converting one means converting every read site *and the sync-provider warm list* in the same commit (the weekly-stats crash).
- **What makes an invalidation load-bearing — check this, don't assume it (Q-262, measured 2026-08-16).** `cachedFetchCore` paints the cached value and then **always** revalidates over the network, so a stale entry can only survive as a *settled* value in two cases: **(a)** a call site passes `freshWithinTtl: true`, or **(b)** a read path is **seed-only** — a screen that `readCacheSync`s the key and never fetches it (the Q-260 shape). Where neither holds, the entry is a first-paint accelerator and clearing it changes nothing except replacing a briefly-stale paint with a blank one — which the instant-paint rule below calls the worse outcome, and which is strictly worse offline, where `cachedFetch` cannot revalidate at all. **This does not license skipping invalidation:** keep writing through the named groups, because a key that is inert today becomes load-bearing the moment someone adds `freshWithinTtl` to it. It licenses *knowing which half of the rule is protecting you* — and it means a stale-value bug report is more often condition (b), a read path with no fetch, than a missed group entry. Audited for one group: all six keys of `invalidateGoalRecommendations()` are inert, [`docs/reviews/2026-08-16-goal-invalidation-audit.md`](docs/reviews/2026-08-16-goal-invalidation-audit.md). The other groups are **not** audited and `cache-groups.ts`'s own comments flag `freshWithinTtl` keys inside them.
- **`freshWithinTtl: true` requires a written invalidation proof**: list every write that changes the payload and show each one's group contains the key. A missed writer converts a stale flash into hours of hard staleness. A today-guard on the cache seed isn't enough on its own — the `cachedFetch` onData hit path needs the same guard, or use `cachedFetchToday`.
- **Never create a bare key that's a prefix-sibling of an existing group prefix** (e.g. `health-trends` vs `health-trends:`) — prefix invalidation silently misses it.
- **Every `/api/*` read bypasses the browser HTTP cache — keep it that way.** `cachedFetch` sends `cache: 'no-store'` and the service worker's `/api/` branch (`public/sw-template.js`) does too. That layer sits *underneath* the cache groups above and is the only cache `invalidateCache()` cannot reach, so a route's `Cache-Control: private, max-age=60` otherwise re-serves pre-write data. **Measured 2026-08-09:** an unsafe method only invalidates its *own* URL, so `POST /api/phase-sets` → `GET /api/phase-sets` self-heals while `DELETE /api/supplements/<id>` → `GET /api/supplements` kept returning the deleted row for a minute — on a route already shipping the header. If you add a new client fetch helper, it needs the same bypass. **That measurement is what retired the old SWR-header rule** — see the `private, no-store` rule above (Q-166, decided 2026-08-10). The two are independent guarantees and both stay: the routes no longer ask to be cached, *and* the client refuses to read from that cache. Keep the bypass even though the headers are gone — it is free, and it is the half that holds for a response from a route that regains a header.

---

## Offline Sync — one write path per domain; the outbox must never wedge

**Strict rule.** Every offline-first domain has two server write paths: the web API route and its `pushMutations` branch in `lib/data/postgres/adapter.ts`. They have repeatedly drifted, and the failure mode is always the same: web works, the APK mutation strands silently.

- **Sync-push must mirror the web route.** If you change a route's write semantics — defaults (`sleepQuality ?? 'ok'`, #47), validation, `ON CONFLICT` target (#74: id-only vs the `(user_id, date, start_time)` partial index), or side effects (PR upserts, phase counters, ownership checks) — update the `pushMutations` branch **in the same PR** and diff the two paths as part of review. Prefer one shared repo function per domain.
- Every UPDATE/DELETE in `pushMutations` is scoped to `user_id`, no exceptions.
- **One bad mutation must never wedge the queue** (3 production incidents: #47, #74, #82). A 4xx/validation failure is a poison pill: quarantine it, don't retry forever, and never let it block the mutations behind it. 5xx/429 = back off and retry. Never `break` the whole push loop on a single failed batch.
- Confirm/delete outbox rows by their stable mutation `id`, never by `domain:date` composites — one failed food log must not strand its same-day siblings.
- When adding or touching a synced domain, verify the full chain in one pass: local table columns = server payload fields = `getSyncDelta` output = `pullDelta` mapping = `applyDelta` upsert columns, **including reference tables needed to render** (a log table must pull its item table too — the `food_items` gap was the #1 data-loss bug). `applyDelta` branches must gate on `sync_status === 'synced'` before overwriting — a pull must never revert a pending local edit.
- **Sync pulls and pushes are paginated — loop the cursor until exhausted** (`packages/shared/src/sync/cursor.ts`, PR #97). Never assume a single response carries the full delta; touching `getSyncDelta` means preserving the `pageLimit`/cursor contract on both ends.
- **Every user-visible write needs an outbox domain** — any POST reachable offline must queue a mutation or visibly fail; `fetch("/api/…").catch(() => {})` is the smell (complete-workout once shipped this way).
- **The outbox payload must carry every field the web route accepts** — adding a route field means updating the local table, the `queueMutation` payload, the `pushMutations` branch, and the pull mapping in the same PR (the GPS-data-loss bug).
- **Local upserts overwrite all columns by default** — a single-field save must read-merge first (copy `water-log-sheet`'s pattern, not `metric-log-sheet`'s).
- **A server hard DELETE is invisible to devices that haven't synced** — any domain with delete UI needs a `deleted_at` tombstone emitted by `getSyncDelta`, or cross-device deletes don't propagate. Any local write to an already-synced row must flip `sync_status='pending'`, or the pull-clobber gate above can't protect it.
- **`pullDelta` domain flags must cover every table the delta applies to** — a new synced domain needs its domain flag and sync-provider group mapping added in the same PR.
- `onConflictDoUpdate` arms are UPDATEs — scope them to `user_id` (`setWhere`) or pre-check ownership, same as any other write.

---

## Local SQLite Migrations — assume partial application

The local DB has been silently dead on Android **twice** from migration bugs (WAL pragma inside the upgrade transaction #27; non-idempotent `ADD COLUMN` rolling back the whole version #85), and each time every local read returned empty — the root of the recurring "my data disappeared" reports.

- No PRAGMAs inside upgrade `statements` — the Capacitor plugin wraps upgrades in a transaction and SQLite rejects journal-mode changes there. Set pragmas post-open.
- `ADD COLUMN` is not idempotent: a retried partial upgrade throws "duplicate column" and rolls back, leaving `open()` throwing forever. Assume any local migration can partially apply.
- Every new local table/column must be registered in `RECONCILE_TABLES`/`RECONCILE_COLUMNS` **in the same commit** as the migration — `reconcileSchema()` is the real schema authority after a partial upgrade, and 17 tables were once missing from it. Two CI checks split this: `check-reconcile.js` covers `ALTER TABLE … ADD COLUMN` and `CREATE TABLE`, and `check-local-column-upgrade-path.js` covers the case it cannot see — **a column added to a `CREATE TABLE IF NOT EXISTS` body reaches fresh installs only.** `CREATE TABLE IF NOT EXISTS` is a no-op on a device that already has the table and `reconcileSchema()` adds only columns named in `RECONCILE_COLUMNS`, so such a column is missing *forever* on upgraded devices while every test and every fresh install passes. Swept over all 41 commits touching `migrations.ts` on 2026-08-09: zero instances, and the check keeps it there.
- Never make a critical write path depend solely on the local store opening.

---

## Postgres Data Migrations — seeds don't fix drifted prod rows

- `ON CONFLICT DO NOTHING` seeds only govern fresh databases; a pre-existing or drifted production row is never corrected (treadmill `is_distance_based` stayed `true` in prod for months — migration 094 couldn't fix it, 101 had to). If a seeded value is load-bearing, ship an explicit idempotent `UPDATE … WHERE` migration.
- Never resolve seeded rows by name at migration run time — they may not exist yet for users who haven't logged in (the 042→047 fix chain). Create what you reference in the same migration; corrective migrations must be unconditional and idempotent.
- A bug that reproduces in prod but not locally: suspect **prod data drift vs the fresh local seed** before suspecting code — the local dev DB is always seeded correct.
- Never delete-and-reinsert rows that other tables FK onto — `ON DELETE SET NULL` wiped session identity on every config save and broke phase tracking across four deploys (sessions 107–109). Upsert in place; edit UIs must round-trip DB ids.
- **Claim migration numbers against both the directory AND open PRs/plan docs.** The tree already carries two collided pairs (081×2, 087×2) and `migrate.js` applies in plain filename sort order, so a duplicate number makes apply order ambiguous. When plans pre-allocate numbers (e.g. 103–107 across parallel batches), honour the allocation; same discipline for local SQLite version numbers.

---

## Stored Counters — derive, or reconcile on read

Every stored counter in this project has drifted (`sessions_in_phase`: over-counted on re-sync in session 87, never decremented on delete, inflated by direct DB edits — fixed three separate times). Derive counts from source-of-truth queries at read time. If a stored counter is unavoidable for performance, pair it with a reconcile-on-read self-heal (`reconcileSessionsInPhase` pattern) **in the same PR** that introduces it.

---

## Safe-Area Insets — every new screen, every time

10+ regressions: headers under the status bar, buttons under the gesture bar (sessions 16, 21, 50, 53, 64, 100, 101, 136, 163, 167, 172, and the fitness-baseline screens 2026-07-19).

- **There is NO native WindowInsets bridge** — on-device clearance depends entirely on the floored CSS utilities. On Android gesture-nav / Capacitor edge-to-edge, `env(safe-area-inset-bottom)` is tiny (~16–24px) or reports 0, so **bare `pb-safe`/`env(safe-area-inset-bottom)` gives near-zero clearance and the button sits on the gesture bar.** `env()` alone is untrustworthy — never anchor a control with it.
- **Bottom-anchored action rows, footers, and primary buttons use a FLOORED utility, never bare `pb-safe`:** `pb-safe-action` (floor 0.75rem) for a row inside a nav-screen, or **`pb-safe-action-lg` (`env + 2rem`, min 4rem) for full-screen / navless flows** (workout phases, fitness-baseline tests, and any takeover screen). Reserve bare `pb-safe` for non-critical *trailing* scroll padding only — it must never be the sole clearance under a tappable control. This exact mistake (floorless `pb-safe` on the fitness-baseline Discard/Save row) is the 2026-07-19 regression.
- Every full-screen header uses the shared `pt-safe`/`pt-safe-or-4` utilities. Never inline `env()` per-screen.
- Verify the utility class actually **exists** in `globals.css` AND is a *floored* variant for anchored controls — `.pt-safe-or-4` was referenced but undefined for a whole release and failed silently (session 167); a class that exists but is the floorless `pb-safe` variant fails the same way on-device (2026-07-19).
- Never combine `pt-safe` with another `pt-*` class — the later Tailwind class wins and the inset is lost.
- **`SheetContent side="bottom"`/`SheetFooter` own the bottom inset** — never add `pb-safe*` inside a bottom sheet; `p-0` does NOT strip the baked padding (tailwind-merge doesn't know the custom classes). Never `pt-safe` on a bottom sheet. `side="left"/"right"` sheets bake nothing — drawers need explicit insets. Floating `fixed bottom-*` elements on nav screens must clear `3.5rem + var(--safe-bottom)`.
- The web sandbox renders insets as 0, so these bugs are invisible until on-device. Treat any new fixed header/footer as unverified until checked on the S25.

---

## One Formula, One Place

Domain math — 1RM, ACWR, weekly cadence, expected RPE, score bands, muscle-name normalisation — lives exactly once and is imported everywhere. **Most of it is in `packages/shared/src/`, not `lib/`** — the monorepo extraction moved it and this rule kept saying `lib/` for months (Q-153). Check [`docs/module-map.md`](docs/module-map.md) for where a given formula actually is rather than guessing a directory. The weekly-cadence formula once existed in **four** copies with two different semantics; 1RM had divergent client/server/edit-path copies (wrong high-rep guard → inflated PRs). `computeVolumeAcwr` is the only ACWR implementation (the old inline flat-÷4 copy in `app/api/training-load` was retired — verified gone 2026-07-06); clients render the route's `interpretation`, never re-band raw numbers themselves. Score-band labels come from `scoreBand()` — never re-derive the 70/50 thresholds with local label strings (two divergent copies found 2026-07-06: `packages/shared/src/session-explain/group-signals.ts`, `app/api/ai/health-insight`). Time windows for stats/AI tools anchor at `todayMidnightUtc(tz)`, never `Date.now() − N×86400000` — six copies of the banned ms-offset pattern shipped in `lib/ai-chat/tools.ts` (2026-07-06 review) after the same class was fixed in session 62. Before writing any formula, grep for an existing implementation. When fixing a formula, grep for its duplicates and fix or delete them in the same PR. Two implementations of the same metric is a bug by definition. **[`docs/module-map.md`](docs/module-map.md) indexes where each formula and shared module already lives — check it before writing a new one.**

---

## External API & Plugin Field Names — verify against the pinned source

Field names written from memory have shipped dead integrations repeatedly: Oura's v2 field is `latency` (not `onset_latency` — NULL in the DB since the integration shipped), Health Connect record keys were wrong **twice in a row** (the pinned alpha uses legacy keys — only the version's sources jar settled it), HRV used `Sdnn` instead of `Rmssd`.

- Before using any external field/key/scope string, read the pinned version's actual source or spec (the bundled Oura OpenAPI, the plugin source in `node_modules`) — not the latest docs, not memory.
- Then prove end-to-end that a **non-null value lands in the DB column** before calling the integration done — a wrong field name reads as `undefined` and fails silently.
- One bad key can reject an entire batch call (Health Connect `requestPermissions`).
- Zod `.optional()` rejects `null` — clients must omit empty fields, never send null (this broke every food save in v1.42.4).

---

## Oura Direct-BLE — the ring is on our key; the pipeline has hard rules

Since 2026-07-07 the Oura Ring 5 is read **directly over BLE** (Kotlin foreground service →
native HTTP ingest → `/api/oura-ble/samples` → `oura_raw_samples`), re-keyed onto our own auth
key (Option A). Pipeline handoff: `docs/superpowers/plans/2026-07-07-oura-ble-phase-3-4-results.md`;
the protocol knowledge base — the `oura-native-ble` skill — **is no longer in this repository**
(Q-49 A4b removed it with the rest of Oura's material; it survives in the archived private repo, and
`scripts/private-paths.json` records why). **Failure-point matrix, sync-cadence
policy, protocol-maintenance playbook, and the data-integrity runbook live in
[`docs/oura-ble-operations.md`](docs/oura-ble-operations.md)** — read it before touching the
pipeline, and add a row to its §1 matrix for any new failure signature in the same PR that
handles it. Consequences and rules:

- **The Oura Cloud gets no new data from this ring, ever.** `/api/oura/sync` succeeding is
  not freshness — its data ends at the re-key. Never "fix" staleness by re-onboarding the
  official Oura app: it can force a firmware update that changes the BLE event encoding
  (the frozen firmware is what keeps our reverse-engineered protocol stable). Treat any
  re-onboard as a full protocol re-validation.
- **Byte layouts come from the `open_oura` Rust source — never memory, never Oura's public
  docs** (they don't cover the BLE protocol). The `oura-native-ble` skill was the second source
  and is gone from this repo; where a code comment still cites it, the Rust source is the one to
  reach for. Every ported builder/decoder is pinned to a captured test vector.
- **`oura_raw_samples.body_hex` is the archival source of truth — on the *server*.** The ring's
  history buffer is finite and the sync cursor only moves forward — a decoder added later can only
  back-fill by re-decoding stored hex, never by re-draining. Never prune or mutate the **server**
  copy of `body_hex`; protocol fixes ship as decoder changes + a redecode pass. (Until D4's
  owner-confirmed cutover moves that archive to the device, at which point this PR rewrites the
  rule.) **The device-local copy is deliberately transient** — a 14-day rolling window, per the
  owner's 2026-08-02 retention decision (`2026-08-02-native-convergence-goal-layout.md` §4 Stage
  1a): raw frames are input to the on-device rollup, not an archive, and an uncapped local store
  would reach ~1.2 GB/year at the measured ~3.2 MB/day. Local pruning is local-only and must never
  reach a server delete or a sync decision.
- **The history cursor may only advance past events that are durably ingested (server 2xx).**
  Advancing on the ring's batch completion alone silently loses the drained span forever
  (found in review `docs/reviews/2026-07-07-oura-ble-system-review.md` BLE-1). Re-sends are
  free — the table dedups on `(user_id, ring_timestamp_ds, tag, body_hex)`.
- **Decoders are infallible:** unknown/malformed bodies return `null` and the raw row still
  stores — never throw, never drop. `ring_timestamp_ds` is a monotonic deciseconds counter
  since the ring's own epoch (resets on re-key/dead battery), not UTC — wall-clock time
  comes from a `(ringDs ↔ utc)` anchor; never treat it as an absolute timestamp.
- **The ring radio/PPG sleeps when worn-idle** (wakes on charger, worn+moving, or during
  sleep) — live HR showing nothing at a desk is firmware power-gating, not a bug. Scan by
  name/manufacturer-id `0x02b2`, never MAC (rotating RPA). Samsung's stack does not honour
  `autoConnect=true` (proven on-device, v1.116.4) — direct connect + bounded same-device
  retry is the pattern.
- **Kotlin changes are compile-gated only in the sandbox** (no Android SDK; Gradle download
  is proxy-blocked) and **require a new APK — which CI builds and publishes**, see
  Canonical Runtime → "Getting a new APK" above (download `apk-latest`; a local Gradle build is
  the fallback, not the default). JS/server changes ship via Railway into the WebView with no
  rebuild at all. State which half a PR touches. On-device is the only real verification for any
  BLE behaviour.

---

## Date Arithmetic — beyond todayInTz()

The timezone rule covers "today"; this covers **ranges and construction**, which kept breaking after "today" was fixed:

- Never hand-add to calendar components — `aestMidnight(y, m, d+1)` built `2026-06-31` and 500'd the workout screen on every month-end (#23); `d-90` went negative. Use `Date.UTC` overflow normalisation or a `packages/shared/src/date-utils.ts` helper.
- Range/window starts anchor at the user's **local midnight**, never `now − N×86400000` — ms-offset windows straddle two AEST days and merge them (session 62).
- Any SQL/JS window boundary (day buckets, week starts, "since midnight") is computed in the user's timezone; give new date aggregations a boundary test at 23:59/00:01 user-local.
- Validate any `new Date(string)` built from DB/API values — `HH:MM:SS` vs `HH:MM` parsing silently dropped timeline events (#54).
- **Every API route that accepts a `date`/`localDate` param routes it through `normalizeDateParam` (`packages/shared/src/date-utils.ts`) before any date arithmetic.** A raw param reaching `split('/')`/`aestMidnight` is a 500 (`RangeError: Invalid time value`). The session-212 fix covered only `/api/day-log`; the 2026-07-06 review found the same gap in `day-timeline`, `workout-sessions/day`, `oura/hr-day` and the ai-chat `localDate` — new routes get the guard at creation.
- **A date-param Zod schema must accept BOTH separators — `z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/)`, never dash-only `/^\d{4}-\d{2}-\d{2}$/`.** The client's `localDateString()` (`packages/shared/src/utils.ts`) emits **`YYYY/MM/DD` with slashes**, and handlers normalise slashes→dashes (`.replace(/\//g,'-')`) — so a dash-only schema rejects **every** real request with a Zod `invalid_format` error *before the handler runs*, and the failure is invisible until a client that fills the param from `localDateString()` calls it. This bit `ai-chat`'s `localDate` for a full release (2026-07-19: chat + any localDate-bearing AI call returned a raw Zod error). The `body-metadata` route's `[-/]` regex is the reference. This is the schema/handler-agreement flavour the `normalizeDateParam` rule above does NOT cover — that rule guards the *handler*; this guards the *validation gate* in front of it. When adding a client-facing date param, grep the client for whether it's filled via `localDateString()` (slashes) before writing the regex.
- **A test may hardcode a timestamp only when BOTH sides of the comparison are fixed.** The moment
  one side is the real clock, an absolute date is a time bomb with a known detonation date.
  `scale-ble-day-keying.test.ts` pinned its input to `2026-07-27T22:00:00Z` and let the route call
  `resolveMeasuredAt(measuredAt)` with its default `now` — so at **22:00 UTC on 2026-08-03** the
  fixture crossed `INGEST_PAST_TOLERANCE_MS` (7 days), got clamped to "now", and the test began
  failing on every branch including `main`. Its siblings were fine for exactly this reason:
  `sensor-ingest-reconciliation.test.ts` passes an explicit `now` in, and
  `complete-workout.test.ts` derives both sides from `Date.now()`. **Derive the fixture from the
  clock (`now − 2 days`) or inject the clock — never hardcode one side of a rolling window.** This
  is a different failure from the hour-dependence rule below: that one fires twice a day, this one
  fires once and then stays red forever.
- **Client code has two "today" sources** — `todayInTz()` vs the device's own timezone. Pick one per feature and don't mix them for keys that must match server bucketing. Repo day-window helpers currently hardcode `DEFAULT_TZ` — thread the session tz through when touching them, and never re-declare `DEFAULT_TZ` locally.

---

## Zustand Persisted Store — transient state must not survive rehydration

Four incidents: confetti replaying on every app open, a render crash from a rehydrated stale summary payload, a phantom "Leave workout?" dialog, cross-session "done" leaks.

- Any new field or mode added to a persisted store must — at the time it's added — either be excluded from persistence or explicitly reset in `onRehydrateStorage`. Screen modes, in-flight flags, and per-screen payloads never survive a reload.
- Daily state is keyed by `(local date, session id)`, never a flat global set.
- Reset-on-mount effects depend only on identity keys (session id), never the store object — the store returns a new ref on every mutation and the effect re-fires forever (session 86).

---

## Android WebView Gotchas (Samsung S25 Ultra)

- Tappable cards containing other controls or drag handles: `<div role="button" tabIndex={0}>`, never nested `<button>` — the browser silently strips the inner button, and native button long-press handling breaks dnd-kit activation. **The inverse holds too: never put interactive content (including `span role="button"`) inside a real `<button>`** — invalid HTML with undefined WebView behaviour, and the span escapes the global 44px tap-target floor (two dismissible banners shipped this way, found 2026-07-06). Dismissible banners follow the container-div + separate-dismiss-`<button>` pattern (the session-select APK banner is the reference).
- SVGs inside card grids can wipe sibling cards' gradient backgrounds on Samsung's WebView compositor. Promote siblings with `willChange: 'transform'`; prefer CSS `conic-gradient` over stroke-dash SVG donuts. Verify on the APK — Chrome renders fine.
- Persist drag-reorder results synchronously inside the drag handler (effects and functional-update side writes are lost on unmount). With `@dnd-kit/react`, apply reorders in `onDragOver`, not `onDragEnd`.
- Capacitor plugin imports are guarded dynamic imports in try/catch (no `webpackIgnore`); chart.js and other browser-only libs load via `dynamic(..., { ssr: false })`.
- The service worker's cache name is build-stamped from the deploy commit SHA (`app/sw.js/route.ts` reads `public/sw-template.js` and injects `RAILWAY_GIT_COMMIT_SHA`) — no manual bump needed, unlike the old `ta-vN` constant that was forgotten twice (sessions 55/74) and shipped invisible changes.

---

## Mobile UI & Performance (S25 Ultra — the only real target)

### Instant paint — a skeleton flash on a repeat visit is a bug

Four separate sessions (147, 155, 165, 167) retrofitted cache-seeding onto screens that shipped with load skeletons. Build it in from the start:

- Every screen/widget that fetches data seeds synchronously from cache (`readCacheSync` / the shared cache keys) and revalidates in the background. First paint shows last-known data, not a spinner.
- Seed in a `useEffect`, **never** in a `useState` lazy initializer — cache reads in initializers caused React hydration mismatches (session 165).
- Timers tick in a leaf component reading refs — never `setInterval` state in an orchestrator. A 1 Hz tick living in the orchestrator would re-render the entire ~1,000-line workout screen (warmup grid, sparkline, heatmap) every second; `active-workout-screen.tsx`'s rest ring and lap/rest counters read from `useElapsedSec`/refs at the leaf instead.
- Heavy widgets (chart.js, markdown/KaTeX, AI chat overlay) load via `next/dynamic({ ssr: false })` — they are both SSR-unsafe and bundle-heavy; static imports of these into top-level screens drag them into every page load. `dynamic(..., { ssr: false })` is only for genuinely heavy deps like these — lightweight data cards are static-imported. A `loading:` skeleton on a cache-seeded card is a contradiction (the skeleton wins and defeats the cache-seed instant-paint rule above).
- Component files stay under ~800 lines. The known hotspots — `session-select-content.tsx`, `workout-screen.tsx`, `config-screen.tsx`, `health-content.tsx`, `program-editor-sheet.tsx`, `more/profile-tab.tsx` — absorb every new feature by default; extract new features into `components/` children instead of appending. (`health-sections.tsx` was on this list and is now 795 lines — under the line, removed 2026-08-09.) The list is no longer maintained by hand: **`scripts/check-component-size.js` fails CI on any new file over 800 lines**, and its BASELINE is shrink-only, so a hotspot that drops under the line must be removed from it in the same PR. Current offenders: `find app components -name '*.tsx' -exec wc -l {} + | sort -rn | awk '$1 > 800'`.

### Saves feel instant — the UI never waits for the network

The log-exercise path is the reference pattern (local write + outbox fallback, POST fire-and-forget, mode flips synchronously). Every save path copies it:

- UI feedback — toast, mode flip, "complete" state, list update — fires synchronously after the local write, never after `await fetch`. Network pushes are fire-and-forget with an outbox fallback; even web-only fallback paths show feedback first and reconcile on error.
- Never `await` POSTs serially in a loop (a multi-ingredient food scan once meant one blocking round-trip per item before the toast) — batch into one request or `Promise.all`, and give the domain an outbox path so it works offline.
- Don't auto-fire slow external round-trips on screens the user is trying to leave (the done screen awaited a live Oura Cloud sync on mount) — put them behind a button or fire-and-forget with a delayed poll.

### Render discipline — memo only works with stable props

- Any card/widget rendered repeatedly or under a fetch-heavy parent gets `React.memo`, **and** its call site passes stable props — an inline arrow or object literal defeats the memo silently (both long-standing memos in the codebase were defeated exactly this way: `onRpeChange` re-rendered SetCard at 1 Hz, an inline `hrData` object re-rendered all 8 home widgets on every parent state change). `useCallback`/`useMemo` at the call site.
- Zustand: subscribe with narrow selectors. Hot-path fields (per-set weight, RPE value) are read by the leaf that renders them via its own selector — never threaded through an orchestrator's broad `useShallow` pick, which turns every dial detent into a full-screen render.
- Rows in editable lists get a stable client id at creation, never `key={index}` — deleting a middle row makes the rows below inherit stale input state.
- `readCacheSync`/`JSON.parse` calls never live in a component body that renders on a timer — hoist to a ref/effect.
- **rAF/animation hooks are timers too** — call `useCountUp`/`useElapsedSec` in the leaf that displays the number, never at the top of a screen; a count-up must animate from the previously displayed value, not reset from zero on every parent render.

### Touch & gestures

- Touch targets ≥ 48dp with ≥ 8dp between them; primary actions bottom-anchored (6.9" screen — top corners are out of one-handed reach). Touch feedback within 100ms (use the shared haptics helpers).
- Custom gesture handlers must **direction-lock before capturing**: pull-to-sync swallowed normal scrolling until a movement-threshold lock was added, twice (sessions 150, 152). Never set `overscroll-behavior: none` on a scroll container to work around a gesture bug. Document-level gesture recognizers must exclude scrollable ancestors generally (any `.overflow-x-auto`, not just tagged carousels) and direction-lock during the gesture, not at touchend.
- Reach for `@use-gesture/react` before hand-rolling touch handling. **Re-counted 2026-08-09 and the old "the installed library has zero imports" is now false** — `useDrag` is used in four places (`app/health/day/day-detail-content.tsx`, `app/nutrition/nutrition-content.tsx`, `components/ui/swipe-carousel.tsx`, `components/calendar-widget.tsx`), so the library is the established pattern here, not an untried one. **Three** hand-rolled implementations remain, and they are the ones to copy *away* from: `app/workout-select/workout-select-content.tsx`, `components/pull-to-sync.tsx`, and `components/shell/tab-swipe-navigator.tsx` (document-level `touchstart`/`move`/`end`).

### Visual consistency & theme

- Semantic UI colours come from theme tokens (`--accent-*` / Tailwind theme colours), never hex literals or hardcoded palette classes — **471** hex literals currently bypass the tuned tokens (`.tsx` under `app/`+`components/`, re-counted 2026-08-15), and literal `text-white` breaks light themes. New UI uses tokens. **The trend was recorded here as improving and it was not** — 455 on 2026-08-07, 430 on 2026-08-09, then **+41 in five days** to 471, unnoticed because this line was prose and nothing measured it. `scripts/check-hex-literals.js` now ratchets it in the Custom Rules job (Q-244, 2026-08-15): a shrink-only per-file baseline, so any file not listed must have zero and a listed file may only shrink. It does **not** sweep the existing 471 — that is separate and much larger. Adding a literal that is genuinely required (canvas paint cannot resolve `var(--x)`; the icon routes have no CSS) means raising that file's number in the same PR, which puts the growth in the diff.
- Lucide icons, never emojis (established convention, sessions 149/155). **Re-checked 2026-08-03: the 2026-07-02 list is out of date** — 🌙 📅 ⚖️ ✅ are gone from nutrition, workout-select and health. What is left is not chrome and should NOT be swept: mood faces (😴 😑 😐 😊 ⚡) and the meal-type 🍽️ are *content* — user-facing values with their own `emoji` field — and `✓`/`✗`/`↓` are typographic marks that the colour-only-state rule actively wants. Emoji in share text (`done-screen.tsx`) is message content too. The rule still binds new **icons**; it does not bind these.
- **Screen backgrounds go through the `bg-page` + dynamic-background system** (`components/dynamic-background/`), never opaque per-screen paint: a `bg-background` root silently hides any wallpaper layer. Background art must sit behind a readability scrim (the `ScrimLayer`/DetailHero pattern), keep body text at ≥4.5:1 contrast, and be designed and verified in **both dark and light** themes — DetailHero currently hardcodes dark and is the cautionary example.
- **Hero/decoration SVGs draw shapes only** — sky/base gradients live exclusively in the shared hero gradient constants (`HERO_GRADIENTS` in `components/health/detail-hero.tsx`); a full-bleed dark rect or bg-colour "cutout" inside a decoration breaks light mode even under a dim wrapper (use mask/clipPath instead).
- **Canvas/SVG chart colours are theme hazards** — gridlines, ticks, and default line colours must never be white/black-alpha literals; resolve tokens via `resolveColor` or scheme-conditional pairs. Any `lineColor ?? 'rgba(255,255,255,…)'` default is a light-mode bug at every call site that omits the prop. **Never pass a `var(--x)` string to chart.js/canvas paint APIs** — canvas `fillStyle` can't resolve CSS custom properties and silently renders black; this shipped again in `workout-load-comparison-chart` (2026-07-06) despite an in-repo comment documenting it. `resolveColor` is a shared import, never re-implemented per component.
- **`useTheme()` mounted-gates default to dark** — any page-root surface coloured from a gated `resolvedTheme` flashes dark for light-theme users on every navigation; prefer CSS-variable/`data-theme`-driven values for page roots.
- Don't convey state by colour alone (colour-coded 1RM deltas, readiness bands) — pair with a symbol or label; maintain 4.5:1 contrast for body text. `scoreBand()` colour always ships paired with `scoreBand()`'s label/icon — colouring a value by band without rendering the band's text is the colour-only-state violation.
- **Semantic palettes (macros P/C/F, sleep stages) are defined once in `lib/` and imported** — Hypnogram's `STAGE_COLOR` export is the reference; don't let the same palette grow a second, drifting copy.
- Before writing a tab strip, confirm dialog, empty state, collapsible, or sparkline: grep `components/ui/` for an existing primitive. Any pattern at ≥2 sites gets extracted before a third copy — the pill-tab markup was copy-pasted ~17× with drifting font sizes. Score-band thresholds are consolidated in `packages/shared/src/health/score-band.ts`, imported everywhere as `@trainingai/shared/health/score-band` (17 call sites) — there is no `lib/health/score-band.ts`. The live sparkline issue is **three** inline polyline implementations bypassing `components/ui/sparkline.tsx` — `components/exercise-history-sheet.tsx`, `components/health-metric-sheet.tsx`, `components/workout/active-workout-screen.tsx`. **Do not just "replace on touch": the primitive cannot draw them yet** (no value label, hardcoded `strokeWidth`, no emphasized last dot, and a fixed ±0.5 value padding that halves the amplitude of a small-range series) — see Q-154 for the prop list. Don't hand-count from `grep -rn '<polyline'`; run `node scripts/check-sparkline-primitive.js`, which is the maintained list. Six files are exempt and were **re-audited 2026-08-09**: the primitive projects x by *index*, so `day-detail/day-sections.tsx`, `activity/exercise-review-sheet.tsx` and `body-battery-card.tsx` — all of which draw a *time* axis — were moved out of the to-convert list, alongside the primitive itself, `health/detail-hero.tsx` (decorative art) and `workout/live-hr-chart.tsx`. Note there is a **second** primitive, `components/ui/sparkline-chart.tsx` (chart.js), drawing the same 1RM-trend shape — it is not interchangeable, and must not be pulled into a hot screen.
- Interactive elements are real controls: shadcn `<Button>`/Radix primitives (Sheet, Dialog, Collapsible) with proper aria state — **9** hand-rolled chevron toggles ship no `aria-expanded` (re-counted 2026-08-09, down from ~18; `deload-explanation`, `signal-sections`, `more/profile-tab`, `health/day-overlay-sheet`, `workout/active-workout-screen`, `workout/ai-prescription-card`, `workout/added-weight-toggle`, `nutrition/meal-card`, `nutrition/saved-meals-sheet`). (The WebView nested-control exception above — `<div role="button">` — still applies where cards contain other controls.)

---

## AI & Security Defaults

- Every LLM call returning structured data uses `generateObject`/a response schema — never `JSON.parse` of free text. Keep it that way: prose-only `generateText` routes must never grow a `JSON.parse` of model text, and every `generateText`/`streamText` call is wrapped in try-catch returning a JSON error (`health-insight` and `weekly-digest` once shipped without). Deterministic math lives in code: no LLM self-reported number (confidence, totals) may gate an automatic action.
- Security checks fail **closed**: a missing signature header, missing signing key, or oversized/mistyped input is a rejection, not a skip (the Oura webhook once skipped verification when the header was absent).
- **Write-path ownership discipline (this bug class recurred across 3 domains — 2026-07-06 review):**
  (a) after a user-scoped UPDATE whose row id came from the client, **check the affected-row count** before any dependent child write — a 0-row match followed by an unscoped `DELETE … WHERE parent_id = id` + re-insert is a cross-user wipe (the `saveProgressionStyle`/`updateSavedMeal` class);
  (b) **never pass a raw request body into Drizzle `.set()`** — `userId`/`deletedAt`/`createdAt` are settable column keys and the TypeScript `Omit<>` is compile-time only; Zod-whitelist every PATCH/PUT body at creation (`updateInjury` is the reference);
  (c) **client-supplied row ids in upserts must be ownership-verified even when the table has no `user_id` column** — pre-check via a join to the owning table (exercise/set logs → `workout_sessions`), exactly as `ensureWorkoutSession` does for session ids.
- **Webhooks verify signatures before any DB lookup keyed on unverified payload fields.** The lookup itself (e.g. a per-user signing key) can't always be avoided, but the *response* must not diverge before verification completes — branching to a different status code for "user not found" vs "bad signature" is an enumeration oracle. Look the user up, but let verification (which already fails closed on an undefined key) produce the response.
- **Ingest routes get a Zod schema at creation**, same as sibling routes — untyped numeric passthrough to the driver is not validation.
- **Self-fetching cards need an explicit failure state** — `cachedFetch` swallows `!res.ok` including your own rate limit; a bare `return null` makes the card vanish silently instead of showing an error state.
- **Cumulative per-day fields from an external API must treat "today" as a partial day** — don't assume a full 86,400s (the Oura `wornHours` mistake); a partial-day cumulative reads as an anomaly if compared against completed-day values.
- Every new AI or expensive route gets the standard rate limit at creation — check its sibling routes and match them.
- No silent fallbacks on failure paths: log and surface an error state; wrap AI/external calls in try-catch returning JSON errors. When adding a DB column, update **every** row→object mapper (`rowToX`, SELECT lists) — a missed field fails silently as "save doesn't persist" (sessions 29, 64).

---

## Process & Review Discipline

- **Sibling-surface sweep**: when fixing or adding a pattern on one surface (a write path, a fetch+sync pairing, a display format, a scale/dial config), grep for every other surface handling the same domain and update them in the same PR — the UI analogue of the sync-push mirroring rule above. A fix applied to one surface and not its siblings is only half done.
- **No global element-selector styling**: tap-target floors, focus rings, and similar UI defaults belong in the shared component (`components/ui/button.tsx` variants), never in a bare `button`/`a` selector in `globals.css`. Any unavoidable global rule needs its opt-outs applied in the same PR, not left for a later audit.
- **Report-invalidation**: never dismiss a user-reported visual bug as "stale build" or "can't reproduce" without reproducing at the S25 viewport (≤640px) against freshly-pulled `main` — the mirror of "never mark an issue fixed from intent" above.
- **No orphaned findings**: any bug or gap written into a plan, review, or journal doc gets a backlog entry or a `projectOverview.md` Known-Issues row **in the same PR**. A documented finding without a queue entry is a dropped finding.
- **Mutation-callback contract**: completion callbacks must carry the written entity (`onLogged(log)`), not fire as a parameterless "please refetch" after a local write — the latter is the pattern behind several of this project's stale-repaint bugs.

---

- Do not add features, refactor, or introduce abstractions beyond what the task explicitly requires.
- Do not add error handling for scenarios that cannot happen — trust internal code and framework guarantees.
- Default to writing no comments. Only add one when the **why** is non-obvious (a hidden constraint, subtle invariant, or surprising behaviour). If removing it wouldn't confuse a future reader, skip it.
- Prefer editing existing files over creating new ones.
- **Prefer pre-made components and libraries over hand-rolling UI.** Before building custom gesture handling, animation, charting, or interaction logic, check if `motion` (Framer Motion), `@use-gesture/react`, `react-chartjs-2`, `@dnd-kit`, or shadcn/ui already cover it. Installed packages: `motion` v12, `chart.js` + `react-chartjs-2`, `@use-gesture/react`, `@dnd-kit/react`.

---

## Database — Connection Pool (load-bearing; do not weaken)

The `pg` Pool in `lib/data/postgres/client.ts` MUST keep its `pool.on('error', …)` handler and the `statement_timeout` / `idle_in_transaction_session_timeout` settings. Without the error handler, a transient DB blip becomes an `unhandledRejection` that crash-loops the process; without the timeouts, a process killed mid-transaction leaves orphaned `idle in transaction` sessions that pin connection slots until the DB hits its limit. Both took production down in session 165. Keep `max` modest (10) — total connections = `max` × replica count must stay under the Railway Postgres connection limit. Before re-enabling or adding a heavy sync domain (e.g. `workout_log`), load-test it against a realistic outbox backlog.

**Accepted risk — TLS `rejectUnauthorized: false` (SEC-I6):** the prod SSL config is encrypted-but-unauthenticated TLS to Postgres. This is deliberate and is Railway's standard pattern (its managed Postgres uses self-signed certs, so certificate verification would fail). The app↔DB link is on Railway's private network. Do **not** cargo-cult this setting into any other outbound connection (external APIs, webhooks) — it belongs only on this Railway-internal DB link. If Railway ever exposes the instance CA, pin it via `ssl.ca` and flip `rejectUnauthorized` back on.

---

## Offline-First — the on-device local store is the source of truth (do not violate)

**This is a strict rule and the cause of a recurring class of "my data disappeared" bugs.** The app is offline-first: the on-device SQLite **local store** (`lib/local-store/`) is the source of truth; the API/Postgres is backup + cross-device sync. Writes go to the local store **and** the mutation outbox (`store.upsertX` + `queueMutation` → `pushMutations`).

**The rule: if a domain WRITES to the local store, its UI MUST READ from the local store (local-first) — never server-only.** A UI that writes locally but reads via `cachedFetch`/`fetch('/api/…')` only shows data once it has synced to the server; any unsynced or sync-failed write silently vanishes on navigation or app restart. That is exactly backwards from offline-first.

**Reference pattern (correct): supplements.** `app/nutrition/nutrition-content.tsx` reads `getLocalStore(userId)` → `store.getSupplements()`/`getSupplementLogs(date)` and only falls back to the API when the store is unavailable/empty. Copy this shape for every offline-first domain.

**Rendering requires the data locally.** A local table must hold enough to render offline. `food_logs` originally stored only a `food_item_id` (no name/macros), so the page was forced to read from the server (which joins `food_items`) — that was the food-disappearing root cause. Any log/reference table needs its display data available locally (its own table hydrated on write + via the pull-delta, or a denormalised snapshot).

**Checklist for any new or touched offline-first domain:**
1. Write path uses `store.upsertX` + `queueMutation` (not just the API).
2. The local table holds everything needed to **render** the row offline.
3. **Every** UI read site reads local-first (`store.getX`), API only as fallback/hydration.
4. Server responses fetched by the page hydrate the local store (so history is available offline next time).
5. Verify on the **APK** — native SQLite does not run in the web/dev sandbox (`getLocalStore` returns null there), so web tests pass while the device path is still broken. On-device is the authoritative check.

Read-site status (re-audited 2026-07-02, session 178): the 2026-07-01 migration list is done — `activity_logs`, `mood_logs`, `body_metrics`, `injuries`, food and supplements all read local-first now. The remaining server-only reads are cross-session aggregates (`weekly-stats`, `weekly-muscle-sets`, `weights-summary`, `muscle-recovery`) which are server-computed by design — leave them on `cachedFetch`. **Sanctioned exception (session 287, R3 SYNC-R3):** `home-day-timeline.tsx` also reads server-only (`/api/day-timeline`) despite merging several already-local-first domains (workouts, food, mood, activity, supplements) — it's a cross-domain server-assembled aggregate (not a single-domain read), and building a client-side timeline assembler that reproduces the server's merge/sort/formatting logic was judged out of scope for the R3 batch that found it. Today's timeline can go briefly stale/blank offline until sync; revisit if this becomes a live pain point.

---

## Canonical Runtime — the S25 APK is the only supported product target

**Policy (2026-07-06, see `docs/superpowers/plans/2026-07-06-apk-canonical-target-dual-path-tax.md`):**
the app's single canonical, supported runtime is the APK on the Samsung S25 Ultra. The web build
exists solely as a dev/QA surface (`pnpm dev` pre-merge testing). This section exists so the
question is never re-litigated per change.

> **Amended 2026-08-02 — this is now a *current* target, not a permanent one.** The owner has
> stated two things that bound it: **other people already use the app** (one friend has an account
> today), and the long-term intent is **production and a Play Store listing**. So "the S25 APK is
> the only runtime" stays true for *engineering trade-offs today* — device-first verification, no
> web-only features — but it is no longer safe to treat "single user, sideloaded, no store" as a
> permanent premise when making architectural decisions. In particular: every write stays `user_id`
> scoped, the sync engine is **maintained and extended rather than reduced**, and no user-visible
> surface should assume the owner's own device or wearable. See
> [`docs/device-agnostic-source-architecture.md`](docs/device-agnostic-source-architecture.md).
> A Play Store listing additionally requires a privacy policy, data-safety declarations, and a
> **declared-use-case review for Health Connect access** — that last one gates real multi-user
> support and is not a formality.

- **When behaviour must diverge, the device wins.** Never add product features or affordances that
  only make sense on web; web-only UI work is frozen.
- **The web online-only read fallback exists only so `pnpm dev` renders.** It must stay
  logic-free: a pure fetch → render pass-through. It must never carry defaults, derivations,
  band/threshold math, or write semantics the device path lacks — a fallback that holds no logic
  structurally cannot drift. Reference pattern: the supplements reads in
  `app/nutrition/nutrition-content.tsx`.
- **One write function per domain.** The web API route and the `pushMutations` branch in
  `lib/data/postgres/adapter.ts` must call the same shared function — `logExerciseFromPayload`
  (`packages/shared/src/workout/log-exercise.ts`) is the reference. The push branch may parse/validate the payload,
  but every actual write goes through the shared function.
  CI enforces this: `scripts/check-push-mutations.js` fails the Custom Rules check if
  `pushMutations` touches `this.db` or raw `sql` directly.
- **Do NOT delete the PWA plumbing** (`app/manifest.ts`, the service worker, the install
  affordance). The APK is a WebView loading the Railway URL remotely (`capacitor.config.ts`
  `server.url`), so the SW is what gives the APK offline cold-start AND is the push-notification
  transport. Removing it is a device regression, not a cleanup. Full PWA removal only makes sense
  as part of the unscoped "bundle the shell into the APK + native FCM push" endgame project (noted
  in `docs/implementation-backlog.md`, not yet planned).
- **Green `pnpm dev` is necessary, never sufficient.** For any change touching an offline-first
  domain, a native plugin, safe-area, gestures, or notifications, the merge gate is the on-device
  smoke run (`docs/device-smoke-checklist.md`) — or, when no device is available in-session, an
  explicit Known-Issues row in `projectOverview.md` marking the change NOT verified on device.

### Getting a new APK — CI already built it; a local Gradle build is the fallback

**First: check whether an APK is needed at all.** The APK is a WebView loading the app from
Railway (`capacitor.config.ts` `server.url`), so **JS, TypeScript and server changes reach the
device through a Railway deploy with no rebuild** — including everything under `lib/`, `app/`,
`components/` and `packages/`. Only `android/**` (Kotlin), `capacitor.config.ts`, and dependency
changes need a new APK. A session should say which half its PR touches; if it's the JS half,
merging *is* the delivery.

**When one IS needed, download it — don't build it.** `.github/workflows/android.yml` compiles the
Kotlin, runs the JVM protocol tests, and builds a debug APK on every PR touching native paths. On
merge to `main` it publishes that build to a single rolling release at a stable URL:

```
https://github.com/nekodas-neko/TrainingAi_Open/releases/download/apk-latest/app-debug.apk
```

Always the newest `main` build, non-expiring, and genuinely no login required — verified in a
logged-out browser on 2026-08-17, which is the entire point of the public-repo migration (Q-49). For an unmerged PR the APK is a
workflow artifact (`app-debug-apk`) on that PR's Android run, kept 14 days.

Note the workflow is **path-gated** on `android/**`, `capacitor.config.ts`, `package.json`,
`pnpm-lock.yaml` — a JS-only PR produces no Android run at all, which is correct and not a
failure. It is deliberately **not** a required status check, so a filtered-out run leaves no
pending check on branch protection.

**Local build — only if CI is unavailable or you need an unpushed working tree.** Sessions can't
do this (no Android SDK in the sandbox; the Gradle download is proxy-blocked), so it is yours to
run. It jumps to the repo root itself, so it is safe to re-run from inside `android/` after a
failed attempt:

```bash
cd "$(git rev-parse --show-toplevel)" && \
git checkout main && git pull origin main && \
npx cap sync android && \
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" && \
cd android && ./gradlew assembleDebug && cd ..
```

Install the result (`android/app/build/outputs/apk/debug/app-debug.apk`) with `adb install -r`, or
transfer it over. If `pnpm`-managed deps changed, run `pnpm install` before `npx cap sync android`.

The `JAVA_HOME` export points Gradle at the JDK bundled inside Android Studio (git-bash/Windows
path — adjust if Android Studio is installed elsewhere, or drop the line entirely once `JAVA_HOME`
is set permanently via Windows Environment Variables).

---

## Package Management

- **Always use `pnpm` to install packages** — Railway deploys with `pnpm install --frozen-lockfile`, so using `npm install` will update `package.json` but not `pnpm-lock.yaml`, causing the build to fail.
- After any `pnpm install`, commit both `package.json` and `pnpm-lock.yaml` together.
- **Triage Dependabot/security alerts when touching dependencies** — don't let them accumulate (55 sat untriaged, 27 high, at session 176).
- **Dependabot remediation is a standing backlog item, worked in batches on a threshold — not every session.** Vulnerability alerts arrive in CVE-driven bursts (independent of your PRs), and no CI check gates on them, so an open alert never blocks a feature PR. Rather than interrupt every session for a stray alert, an implementer session takes the standing "Dependabot vulnerability remediation" item **before** any numbered feature/fix item **only when the debt crosses a threshold**: **≥ 5 outstanding high/critical alerts**, OR **any single _critical_ alert older than ~1 week**. Below that, let them accumulate and sweep them in the next batch. When it does trigger, clear high/critical in one or a few small **grouped** PRs (bump the vulnerable deps, run the full gate, verify nothing broke), then re-check the security dashboard. `.github/dependabot.yml` batches the alert inflow into grouped security PRs so a burst becomes one PR, not N. The standing item lives in the queue permanently and is never "completed" — only driven back below threshold; moderate/low alerts are cleared opportunistically when touching related deps.

---

## Safety & Reversibility

- Never force-push, `reset --hard`, or run any destructive git operation without explicit user confirmation.
- Never skip hooks (`--no-verify`) — investigate the failure and fix the root cause instead.
- Never commit secrets, `.env` files, or credential files under any circumstances.
- Confirm with the user before any action that affects shared systems: posting comments, sending messages, or closing PRs. **Exempt (per the CI/CD PR workflow):** pushing to a feature branch, opening a PR, and merging a tested, CI-green PR — those proceed without asking, except the destructive/irreversible carve-out (data-dropping migrations, auth/security, secrets), which is still confirm-first.

---

## Git Workflow

- Never commit directly to `main` (branch protection blocks it anyway). Always develop on a feature branch and merge via PR once CI is green.
- **Merge a tested, CI-green PR without asking** (see Standing Instructions). Confirmation is only required for destructive/irreversible changes — data-dropping/non-reversible migrations, auth/session/security, secret handling — where you present the work and ask before merging. Docs/plans/already-shipped-bug-fix PRs need no gate at all.
- **Branch names must describe the change**, not use auto-generated names. Use short kebab-case that reflects the work: `fix/avatar-storage`, `feat/rate-limiting`, `security/admin-db-flag`. Never use generated names like `claude/vibrant-volta-0SkCX`.
- **Commit messages must not include Claude-specific metadata** — no session URLs, no "generated by Claude", no AI attribution of any kind. Messages should read as if written by a human engineer: what changed and why, nothing else.
- Write commit messages focused on **why** the change was made, not what changed (the diff already shows that).
- Run tests and lint before committing. If they fail, fix them — don't bypass.
- **Start every follow-up branch from a freshly-fetched `main`.** Squash-merge + auto-delete-head-branch means stale local refs break things silently — CI has failed to trigger entirely off a stale base (sessions 167, 171–173). Ritual: `git fetch origin main && git remote prune origin && git checkout -B <branch> origin/main`. If CI doesn't start, suspect a stale base and rebase before anything else. Expect `package.json`/`packages/shared/src/changelog.ts` conflicts when PRs land in parallel — resolve by re-bumping on the fresh base.
- **Commit before you switch branches, and never `git add -A` straight after a checkout that carried changes.** `git checkout <other-branch>` with a dirty tree silently *carries the modified files across*, and the next `git add -A` sweeps them into a commit on the wrong branch. This happened **twice in one session (2026-08-08)** while working several items in parallel: Q-127's two-file change rode into Q-119's PR (#1140) and shipped under its name, so `git log` attributes it to a change it has nothing to do with. Nothing unsound merged — both files were CI-green either way — but the history is wrong and it took a revert commit plus a correction note in three documents to make honest. The habit that prevents it: **commit (or stash) before every `git checkout`**, and if a checkout prints modified paths you did not expect, run `git status` before staging anything. Prefer `git add <paths>` over `git add -A` when several items are in flight.
- **A Q number is claimed against the queue file AND every open PR.** Same discipline as migration numbers, and the backlog header says so — but it is easy to grep only `docs/implementation-backlog.md` and miss a number an *unmerged* PR already took. On 2026-08-08 a finding was filed as Q-141 when #1143 already held it; the parallel agent caught the duplicate and refiled it as Q-146. Before taking the next free number, check the open-PR list too.
- **Resolve `package.json` / `changelog.ts` conflicts by rebuilding from `origin/main`, not by splicing the conflict hunks.** When the conflict falls *inside* an entry's `changes:` array — which it does whenever two PRs bump on the same day — both sides share the `version:`/`date:` header above the marker, so a naive splice produces an entry with no header and silently drops the other PR's version. This corrupted the changelog twice on 2026-08-08 before the approach changed. The reliable shape: take `git show origin/main:packages/shared/src/changelog.ts`, prepend your entry at the next free number, and write the whole file.
- **In a session that merges several PRs in a row, "freshly fetched" goes stale while you work — re-merge `main` immediately BEFORE opening each PR, not just before creating the branch.** This bit three times in one session on 2026-08-04 (#1052, #1056→#1060 twice) *while the rule above was being followed correctly every time*: the branch was cut from a genuinely current `main`, then an earlier PR of the same session merged, and by the time this one opened its base was behind. You cannot fetch a commit that does not exist yet, so the rule above cannot prevent it. **The tell is distinctive and worth learning: `get_check_runs` returning `total_count: 0` several minutes after opening a PR is a stale base, not slow CI** — real CI reports queued/in-progress checks within about a minute. The fix is `git fetch origin main && git merge origin/main`, resolve, push; checks start immediately. Do not sit waiting on a monitor for checks that will never arrive.

---

## Communication

- State in one sentence what you are about to do before doing it.
- Report blockers clearly rather than silently working around them.
- **When presenting work, state which failure surfaces were NOT exercised.** The recurring pattern behind "verified but broken": the failing path is unreachable in the sandbox. Every "works locally" claim must name which of these were not tested — native SQLite/Capacitor plugins, safe-area insets, drifted prod data (fresh local seed masks it), real Oura/Health Connect tokens, Samsung WebView rendering — and run `docs/device-smoke-checklist.md` as the concrete on-device verification step for each. The Canonical Runtime section above defines the device-first policy this rule enforces.
- **Never mark an issue fixed from intent.** Before writing "fixed" in the journal or striking a Known Issue, confirm the change exists in the committed diff and was observed working (on-device for APK-only behaviour) — a session once documented a fix that was never applied to the file, and eight fixed items once lingered unstruck.
- Ask before taking any irreversible or wide-blast-radius action — the cost of pausing is always lower than the cost of an unwanted action.

---

## After Every Change — Local Testing Instructions

After making any change, provide the following:

**1. Pull command** — give the exact command to fetch the latest changes locally:
```bash
git pull origin <branch-name>
```

**2. What to look for** — specify exactly:
- Which page, component, or API route is affected
- What the expected visible or behavioural change is
- Any edge cases or regressions to check (e.g. adjacent features that touch the same state or UI)

**3. How to test it** — give step-by-step instructions appropriate to the change, for example:
- Which URL to open and what action to take
- What the correct outcome looks like vs. a broken outcome
- Any specific device/viewport to test on (this app targets Samsung Galaxy S25 Ultra)

---


Personal gym tracker PWA. Samsung Galaxy S25 Ultra. Railway auto-deploy from `main`.

## Stack
- Next.js 15 + React 19 + TypeScript
- Tailwind CSS v4, Radix UI, shadcn/ui
- Gemini 3.1 Flash Lite via `@ai-sdk/google`
- PostgreSQL on Railway via Drizzle ORM (`DATABASE_URL`)
- Google OAuth2 (refresh token in session JWT cookie)
- Railway hosting, auto-deploys from `main`

## Architecture

**Workout flow** — five modes (`WorkoutMode`):
```
"pre" → "warmup" → "active" → "exercise-summary" → back to "pre" or "done"
```

`components/workout-screen.tsx` is the orchestrator: holds all state, refs, and callbacks. Children are pure rendering components in `components/workout/`.

**Orchestrator pattern**: parent holds state, children receive props + callbacks. Refs (`lapStartRef`, `restStartRef`) passed as `MutableRefObject` so children always read fresh `.current`.

**Workout phases** (within "active" mode): `"rest" | "set"`
- `"rest"` → rest timer running, Start button bounces on active set card
- `"set"` → set timer running, SVG border animates on active set card, Log button shown

## Key Files

| File | Role |
|------|------|
| `components/workout-screen.tsx` | Orchestrator — all state, refs, callbacks |
| `components/workout/pre-workout-screen.tsx` | Exercise list, start/complete workout |
| `components/workout/active-workout-screen.tsx` | Ready screen + in-progress workout UI |
| `components/workout/exercise-summary-screen.tsx` | Per-exercise summary after logging |
| `components/workout/done-screen.tsx` | Workout complete screen |
| `components/workout/set-card.tsx` | Individual set card (W1 bounce, W2 SVG border) |
| `components/workout/leave-workout-dialog.tsx` | Mid-workout leave confirmation |
| `components/workout/one-rm-calculator-dialog.tsx` | 1RM calculator modal |
| `components/workout/types.ts` | `WorkoutMode`, `ExerciseSummaryData`, `SessionLogEntry` |
| `components/workout/utils.ts` | `formatTime`, `mround125`, `SET_COLORS` |
| `packages/shared/src/1rm.ts` | `calc1RM`, `calcAmrap1RM`, `calculate1RM` (1RM/target80 estimation, shared client+server) |
| `components/ui/weight-dial.tsx` | Scroll wheel weight picker |
| `app/globals.css` | `border-run` + `ta-marquee` keyframes |
| `app/api/workout-data/route.ts` | Reads program + exercise list from DB |
| `app/api/log-exercise/route.ts` | Writes set log to DB, calculates 1RM |
| `app/api/log-calendar-event/route.ts` | Creates Google Calendar event on session complete |
| `lib/data/repository.ts` | Repository interface — all DB access goes through here |
| `lib/data/postgres/adapter.ts` | Drizzle/PostgreSQL implementation of the repository |
| `lib/data/postgres/schema.ts` | Drizzle table definitions |
| `lib/data/postgres/migrations/` | SQL migrations (auto-applied by `ensureSchema` on cold start) |
| `lib/sqlite/cache.ts` | Client-side SQLite cache (`cachedFetch` + `readCacheSync`) |
| `auth.ts` | NextAuth config — JWT session cookie (`import { auth } from "@/auth"`) |

## Data Model

All data lives in PostgreSQL (Railway). Key tables:

| Table | Purpose |
|-------|---------|
| `users` | Auth, profile, timezone, isAdmin |
| `programs` + `program_sessions` + `session_exercises` | Training programs — fully user-defined, no hardcoded session names |
| `progression_styles` + `style_sets` | Named progression styles (per-set pct/reps/rest) |
| `schedules` + `schedule_days` | Which session runs on which day |
| `workout_sessions` + `exercise_logs` + `set_logs` | Full workout history |
| `body_metrics` | Weight, body fat, steps, calories, macros, HRV, RHR, SpO₂, active_calories |
| `exercise_library` | Exercise catalogue with muscle group assignments |
| `sleep_sessions` | Sleep duration, stages, + Oura: HRV, HR, efficiency, onset latency |
| `mood_logs` | Daily energy/mood check-ins |
| `personal_records` | All-time 1RM per exercise |
| `oura_tokens` | Dead Oura Cloud credentials — the integration is gone, the rows are kept |
| `oura_daily` | Daily readiness, sleep, activity scores + contributors from Oura Ring |

## Oura Ring — the Cloud integration is GONE (owner, 2026-08-13)

The user wears an **Oura Ring 5**, read **directly over BLE** since the 2026-07-07 re-key — see
**Oura Direct-BLE** above, which is the live pipeline and the only one. The Oura *Cloud* integration
was removed on 2026-08-13 at the owner's instruction (*"get rid of oura cloud references we dont use
it"*): no OAuth/PAT flow, no `/api/oura/{connect,callback,sync,token,webhook}`, no Oura HTTP client,
no webhook receiver, no token storage. **Do not re-add a Cloud call.** It could not succeed anyway —
the ring is on our key, so every one of those requests earned a 401 — and re-onboarding the official
Oura app to fix that would risk a firmware update that breaks the reverse-engineered BLE protocol.

**The v2 API reference tables that used to live here were deleted with the code.** They described
endpoints nothing calls. If you ever need one, read the bundled OpenAPI spec — never memory, and
never these docs for **BLE** field names, which come from the `open_oura` Rust source.

**What is deliberately kept, and why:**

- **The historical Cloud data.** `oura_daily`, `oura_daily_summary`, `oura_daily_derived`, and the
  Cloud-era rows in `sleep_sessions` / `body_metrics` are the owner's health history from before the
  re-key, read by `app/api/health-trends`, `app/api/day-timeline` and the sync engine. Removing the
  integration is not removing the data. `oura_tokens` still exists too — dropping it is a data-losing
  migration that buys nothing.
- **`lib/oura/cloud-freshness.ts`** — the single `OURA_CLOUD_REKEY_DATE` constant. It makes no
  network call; it is how two live readiness paths know a Cloud-dated value is a frozen snapshot.
- **The six surviving routes under `app/api/oura/`** — `hr-data`, `hr-day`, `hr-sync`, `hr-window`,
  `workouts`, `stats` — all local reads despite the `/oura/` prefix. `hr-sync` in particular is BLE **attribution**, not a Cloud pull.

**`oura_workouts` is read-only history now.** Its only writer was the Cloud sync; the owner's newest
row is 2026-07-05 and the "Exercise detected" card's unreviewed query only looks back 30 days, so
that card has already been permanently empty since ~2026-08-04. A BLE-side detector would be new
work, not a restoration.

### Health writes — the ranked per-field merge

Health writes go through the **ranked per-field merge** in `lib/data/health-source.ts`, not a plain
`COALESCE`. Sources are ranked `manual (5) > scale_ble (4) > oura_ble (3) > oura_cloud (2) >
health_connect (1) > unknown (0)`; `mergeSet()` compares rank per column against the stored
`source_map` and re-stamps provenance only for columns the write actually won. (`body_metrics`,
`sleep_sessions` and `oura_daily` carry `source_map`.) This supersedes the older row-blind
`COALESCE(EXCLUDED.col, table.col)` description — the difference is behavioural, not cosmetic:
COALESCE was first-write-wins and could never let a better source correct a worse value; the rank
merge can. `saveSleepSession` takes a **required** `source` and delegates to `upsertOuraSleep`, so
both sleep writers share one function and the same per-field merge (Q-43, v1.250.0). Keep `source`
required — a caller left on a default writes rank-0 and beats the ring forever. The `oura_cloud`
rank stays in the ladder: nothing writes at it any more, but the stored `source_map` of every
pre-re-key row still names it, and a live BLE write must out-rank those rows rather than tie them.

### Oura-specific DB tables

| Table | Purpose |
|---|---|
| `oura_tokens` | Dead Cloud credentials, kept rather than dropped (see above) |
| `oura_daily` | Daily readiness / sleep / activity scores and JSONB contributors |

`sleep_sessions` has Oura columns: `oura_id` (UNIQUE, dedup key), `efficiency`, `onset_latency_sec`, `average_hrv_ms`, `avg_heart_rate`, `lowest_heart_rate`, `restless_periods`, `sleep_score`.
`body_metrics` has `active_calories` column (Oura activity calories burned, distinct from food `calories`).
---

## Progression Styles

Stored in `progression_styles` + `style_sets` DB tables. Each style defines per-set `{ pct, reps, restSec, useFor1rm }`. Programs reference styles by UUID — never by name.

## Animations

- **W1**: Start button `animate-bounce` when `workoutPhase === "rest"` and set is active
- **W2**: SVG `<rect>` with `stroke-dashoffset` animation (`border-run` keyframe in `globals.css`) traces the border of the active set card when `workoutPhase === "set"`
- **Rest ring**: the inline SVG progress ring in `active-workout-screen.tsx` (drawn from `restProgress`/`isRestOvertime`) shows the countdown during the rest phase — not a separate component

## Known Issues

1. ~~Cache not invalidated after config saves~~ — addressed (session 104): program save/activate/delete and style edits now call `invalidateProgramStructure()` (`workout-data`, `next-session`, `progression-styles`, `muscle-recovery`); workout/set/mood/body/activity writes invalidate their derived summary caches via `lib/cache-groups.ts`.
2. ~~Workout state lost on page refresh~~ — mitigated: `lib/stores/workout-store.ts` uses Zustand `persist` to `localStorage` with no `partialize`, so mode, timers, and set data survive a refresh; `onRehydrateStorage` clears stale `todayLogged` on date rollover.
3. AI chat uses `gemini-3.1-flash-lite` — confirmed valid model ID, ~1,500 RPD free tier

## Local Development Database (Claude Code on the web)

Sessions cannot reach the production Railway Postgres instance directly (its
proxy port is blocked by the sandbox network policy — only 80/443 are open).
Instead, a local Postgres 16 instance is set up automatically:

- `.claude/hooks/session-start.sh` runs `scripts/local-db/setup.sh` at the start
  of every remote session (only when `CLAUDE_CODE_REMOTE=true`).
- The script `initdb`s a cluster at `/var/lib/postgresql/local-dev` (if missing),
  starts it on port 5433, creates a `trainingai_dev` database, and applies all
  migrations from `lib/data/postgres/migrations/` via `scripts/local-db/migrate.js`.
- On first run only, it seeds fake data (`scripts/local-db/seed.sql`): one test
  user (`test@local.dev`), a Push/Pull/Legs program with a progression style and
  schedule, ~9 logged workout sessions, and 1-2 weeks of body metrics, sleep and
  mood data.
- It writes `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/trainingai_dev`
  to `.env.local`, which `next dev` picks up automatically.
- **The session-start hook exports a different, Unix-socket form** —
  `postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433`. Both reach the same
  database and either is fine for ordinary work, **but a test that re-points the URL at another
  Postgres role cannot do it over a socket**: rewriting the credentials leaves the connection as the
  superuser. `claude-ro-readonly-role.test.ts` is the one that does this, and under the socket URL
  it used to fail 20 of 21 tests at once — reading exactly like a broken read-only guarantee when it
  was a broken harness (cost a session on 2026-08-04; it now skips loudly instead). **If a DB test
  behaves differently under `pnpm test` than you expect, check which URL form is in your shell
  first.** Re-run role-sensitive suites with the TCP form above.
- Re-running `pnpm db:local` is safe — it's fully idempotent and won't re-seed if
  the `users` table is non-empty.
- **The Oura rollup tests were marginal by construction — fixed 2026-08-05, and the old advice is
  now narrower.** Those files (`oura-ble-*`, `oura-hrv-median-rollup`, `oura-illness-persist`,
  `sleep-oura-id-user-scope`) run a full `aggregateOuraRawSamples` pass. **Measured alone with zero
  contention they take 3.4 s to 14.6 s** against vitest's 5000 ms default — three of them sat within
  20% of the limit, so any parallel load tipped them over. That, not row collision, is what produced
  **four false alarms in one session on 2026-07-28**. They now run in a separate `rollup` vitest
  project with a 60 s timeout (`vitest.config.ts`); the other ~380 files stay at 5 s so a genuine
  hang still fails fast. **Keep the glob in step with
  `grep -rl aggregateOuraRawSamples lib/data/postgres/__tests__/`** — a new rollup test outside it
  inherits the 5 s default and becomes the next false alarm.
- **Genuine pool exhaustion is still possible, and looks different.** All of
  `lib/data/postgres/__tests__/*` share one `trainingai_dev` instance; each vitest worker opens its
  own `pg` pool (`max: 10`, `lib/data/postgres/client.ts`) against `max_connections = 100`. A
  connection-acquisition failure — not a 5 s timeout — is that signature, and running a `pnpm dev`
  server at the same time makes it likelier, so stop it first. **A rollup test that times out now is
  worth believing** rather than re-running away.
- **Never run two full suites against the local DB at once — `migration-test-lock.test.ts` will fail, and it is right to.** Its `afterAll` asserts that no advisory lock is still held, so that the next file to take it does not hang. A second concurrent suite holds that lock, and the assertion fires as `expected 1 to be +0` in a file that has nothing to do with your change. Measured 2026-08-13: stacking runs produced exactly that, **1 test file failed with 0 failing tests** — the tell that it is a hook, not an assertion — and the file passed 3/3 alone seconds later with `pg_locks` empty. Check `SELECT count(*) FROM pg_locks WHERE locktype='advisory'` before believing it. Also: `pkill -f vitest` kills the background *monitors* watching the run too, and a killed run exits 143, which reads like a failure and is not.
- **Many suite runs in quick succession poison `rate_limits`, and the failure names another test.**
  The local DB persists `rate_limits` rows between runs, so a burst of runs inside one limit window
  makes routes the suite exercises start returning `Too many requests` — surfacing as an unrelated
  assertion like *expected 'Too many requests' to contain 'Invalid date'*, alongside
  `Hook timed out in 10000ms` from the pool contention riding with it. Measured 2026-08-12 during a
  seven-mutation verification pass: `DELETE FROM rate_limits` then re-run gave 448 files / 3,697
  tests green, **twice consecutively**. So it is load-dependent, not a repeat-run hazard — two
  back-to-back suite runs are fine. Clear the table before believing a failure of this shape.
- CI runs the suite on a clean database, so it is the better signal — but it is **not** infallible:
  on 2026-07-28 it went red on a genuine, deterministic failure that had nothing to do with the diff
  (see the hour-dependence rule in "Date Arithmetic"). A red CI on an unrelated change is worth one
  minute of checking before it is dismissed as noise.

- **To catch hour-dependent tests, run the suite under a faked clock:**
  `apt-get install -y faketime`, then
  `faketime '2026-07-28 14:10:00' env DATABASE_URL=... npx vitest run` (14:10 UTC = 00:10 Brisbane).
  **Caveat that will otherwise waste your time:** `faketime` shifts *node's* clock but not the
  already-running Postgres, so any DB-backed test mixing node time with the DB's `now()` fails
  spuriously once the skew exceeds its tolerance. `oura-battery-poll` is the known example — it
  documents a ±1h margin, and measured here it passes at a +10 min skew and fails at +3 h. That is
  the method misfiring, not a bug. The technique is sound for pure-logic and same-clock tests; a
  sweep at 00:10 and 04:00 Brisbane on 2026-07-28 found no hour-dependent tests beyond the one
  already fixed in #872.

Use this for any DB read/write testing during a session. To reset, drop
`/var/lib/postgresql/local-dev` and re-run `pnpm db:local`.

**Gotcha — pre-set `DATABASE_URL`/`DATABASE_SSL` env vars:** the container
provisions `DATABASE_URL` (pointing at production Railway) and `DATABASE_SSL=true`
as real process env vars. Next.js does **not** let `.env.local` override an
already-set `process.env` var, so `pnpm dev` will silently try to use the
production DB (and fail, since `DATABASE_SSL=true` makes `pg` require SSL,
which the local Postgres doesn't support) unless both are unset first. The
`session-start.sh` hook writes `unset DATABASE_URL` / `unset DATABASE_SSL` to
`$CLAUDE_ENV_FILE`, so a fresh shell in the session picks this up automatically.
The test user `test@local.dev` has password `testpass123` (seeded with a bcrypt
hash) for credentials-login testing.

## Environment Variables

Required in Railway:
- `DATABASE_URL` — PostgreSQL connection string
- `SESSION_SECRET` — JWT signing
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` — OAuth
- `GOOGLE_GENERATIVE_AI_API_KEY` — Gemini (used by every `@ai-sdk/google` route)
- ~~`GEMINI_API_KEY`~~ — **no longer used by any code (Q-189, 2026-08-12).** Its only consumer was the text-to-speech route, which was deleted with the unreachable legacy chat surface. Safe to remove from Railway; the app never reads it. The `@google/genai` package stays — `lib/exercise-image-gen.ts` still uses it, but on `GOOGLE_GENERATIVE_AI_API_KEY`, so nothing reads `GEMINI_API_KEY` any more.
- `HEALTH_CONNECT_INGEST_SECRET` + `WEBHOOK_USER_ID` — Tasker auth for `app/api/health-connect/ingest/route.ts`

Optional:
- `CLAUDE_DB_READONLY_URL` + `CLAUDE_DB_QUERY_SECRET` — enables `POST /api/admin/db-query`, a read-only
  SQL endpoint over the curated `claude_ro` view schema (whole-history audits: counter drift,
  null-rates, orphans, blast-radius measurement). **Read-only is enforced by the `claude_readonly`
  Postgres role, never by inspecting the SQL** — a keyword allowlist loses to
  `WITH x AS (INSERT … RETURNING *) SELECT * FROM x`; the role does not. Fail-closed on either var
  and still `requireAdmin`-gated. The role is created out-of-band (it carries a password, which must
  never live in a committed migration) and uses its own `max: 2` pool, never the app's `max: 10`.
  Approved **for the beta period only** — see the beta-exit review row in `projectOverview.md`.
  Emergency stop, no deploy: `REVOKE ALL ON SCHEMA claude_ro FROM claude_readonly;`
  **Row-scoped to ONE user** (`CLAUDE_RO_OWNER_USER_ID` at generation time): production holds several
  real accounts with months of sleep/weight/food data, and they cannot consent on the owner's behalf.
  Tables without `user_id` are scoped via a documented FK path; a table that is neither user-scoped,
  FK-reachable, explicitly global, nor explicitly denied makes the generator **fail** rather than emit
  an unscoped view. `invited_emails`/`rate_limits` are denied outright (third-party PII, no audit value).
  **When you add a table, re-run `CLAUDE_RO_OWNER_USER_ID=<id> node scripts/generate-claude-ro-views.js`
  into a NEW migration number** (never overwrite the previous one — `ensureSchema` tracks by filename,
  so an edited already-applied migration is skipped forever and the change silently never lands) — the schema is default-deny, so a new table is unreadable
  until it has a view, and a DB-backed test fails if the counts diverge. The migration DROPs and
  rebuilds the schema each run: `CREATE OR REPLACE VIEW` would leave a stale unscoped view serving its
  old definition forever.
- `ADMIN_EXPORT_SECRET` (+ `ADMIN_EXPORT_USER_ID`, falling back to `WEBHOOK_USER_ID`) — enables the
  `Authorization: Bearer …` path on `GET /api/admin/day-review`, so a window of score-audit days can be
  pulled without a browser session (offline score-calibration review). **Read-only, GET-only, and
  fail-closed**: unset either var and the bearer path is disabled entirely — never skipped — and the
  resolved user must still be an admin, so the token widens *transport*, never authority. Anyone holding
  it can read that user's health history, so treat it as a credential: generate with
  `openssl rand -hex 32`, never commit it, rotate by changing the Railway var. Leave it unset and the
  route is session-only.
- ~~`GITHUB_RELEASES_TOKEN`~~ — **no longer needed (Q-49, 2026-08-17).** It was required while the
  releases lived in a private repo, where an unauthenticated call could only 404. The repo is public,
  so `lib/github-release.ts` now sends the `Authorization` header only when a token happens to be
  set, and works without one. **It had been unset in Railway since 2026-08-04**, which is why the
  update card and More → Download APK were dead for two weeks — going public is what revived them.
  Setting it is still harmless and buys a higher rate limit (5,000 req/hr against 60 per IP), but
  neither limit is close, so treat it as an optimisation and never as a dependency.
  The route queries `/releases/tags/apk-latest` (not `/releases/latest`) because
  `.github/workflows/android.yml` publishes the rolling APK release with `--prerelease`, which the
  `/latest` endpoint excludes regardless of repo visibility.
- `APK_RELEASE_REPO` — which repo `lib/github-release.ts` reads releases from. Set to
  `nekodas-neko/TrainingAi_Open`. The code falls back to the pre-cut repo, which is archived, so
  leaving it unset means reading a release whose version never changes again.
