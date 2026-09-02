# TrainingAI — Claude Code Context

## Standing Instructions

- **Everything reaches `main` through a pull request — direct pushes to `main` are blocked.** Branch protection on `main` requires a PR with all CI checks passing (Lint, Tests, Build, Custom Rules, Migration Check — type checking rides inside Build, it isn't a separate job) and blocks force-pushes/deletions, so there is no direct-commit path. Always develop on a feature branch, open a PR, let CI run, then squash-merge. (Merges use the GitHub MCP tools, since the sandbox git proxy can't push to `main` either.)
- **Merges to `main` are OK once the change is tested and CI-green — no merge-confirmation needed for standard changes.** With the CI/CD pipeline in place, a change that passes all required checks (Lint, Tests, Build, Custom Rules, Migration Check) *and* meets the "tested" bar below may be merged — or set to **auto-merge** — without asking first. **"Tested" means:** local `pnpm dev` pass exercising every changed API route and UI flow, **and** the device-verification gate satisfied (per Canonical Runtime — offline-first/native/safe-area/gesture/notification changes need the on-device smoke run *or* a Known-Issues row in `projectOverview.md` marking them not-yet-device-verified), **and** CI fully green. **Confirmation is still required for destructive or irreversible changes** — data-dropping or non-reversible DB migrations, auth/session/security changes, and secret handling — present those and ask before merging. Merging auto-deploys to Railway production, so that carve-out is the real safety valve, not a formality.
- **Always test on the local dev server before merging.** Before merging (or presenting work for confirmation on a destructive change), spin up `pnpm dev` and exercise every changed API route and UI flow against the local non-prod database. TypeScript and lint passing is not sufficient — runtime errors, broken validation, and cache bugs only surface when the server actually runs. If something breaks during testing, fix it before asking to merge.
- **The local custom-rules gate is `pnpm check:rules` — nothing else counts as "custom rules pass".** It parses `.github/workflows/ci.yml`, runs every step of the job named *Custom Rules*, and prints how many it ran (`Ran N of N …`); quote that count rather than the word "pass". **Do not hardcode N anywhere** — it was 31 on 2026-08-13 and 33 by the end of the same day; the runner reads it from the YAML, which is the point. Globbing `scripts/check-*.js` reaches only the steps that invoke a script — the difference between that and `Ran N of N` is the count it misses — and `pnpm ci:local` used to run 3, and both report clean while the inline grep rules — UTC date slicing, hardcoded session names, safe-area stacking, local-SQLite PRAGMAs, nested buttons, `JSON.parse` of LLM output, hand-rolled `invalidateCache` — never execute. That gap shipped a component-level `invalidateCache()` call through a green local gate (#1279). `pnpm ci:local` now runs it.
- **Docs/plans/low-risk changes merge with zero ceremony.** **Documentation-only** changes (`.md` files like `projectOverview.md`, `CLAUDE.md`), **implementation plans / planning docs** (`docs/superpowers/plans/`), and **bug fixes for features already on `main`** never need confirmation and are exempt even from the destructive-change carve-out above (they can't be destructive by nature). They still need a feature branch + green CI — that's the only path now. Note: a *markdown-only* PR still runs CI (the `pull_request` trigger has no `paths-ignore`) so required checks report and it can merge.
- **At the start of every session, work out which standing agent you are** — read [`docs/agents/README.md`](docs/agents/README.md). Five roles run against this repo (Orchestrator, Implementation in two lanes, BugFix, Tuning, Review), up to six sessions concurrently, and that file is the contract between them: who owns which files, which letter your entry IDs come from, and what you may merge without asking. **A standing agent is meant to run as one continuous session per role** — rely on Claude Code's automatic context compaction rather than writing a handoff and spawning a successor just because context is getting long; that keeps cached tokens working for you instead of resetting them. Handing off to a successor is now the exception (owner reset, or a session lost outside your control), not the routine end of a generation — see `docs/agents/README.md` §4. If you were started from one of the prompts in `docs/agents/prompts/`, read your own baton at `docs/agents/state/<agent>.md` before anything else — it is the state your predecessor (or your own earlier self, after a reset) left you.
- **At the start of every session**, read `projectOverview.md` first — it is a lean index holding current status, the live Known Issues & Risks tables, and the **What's Left To Do** list. Use it to orient before doing anything. The session journal lives in `docs/overview/entries/` (recent, one file per PR) and the batched `docs/overview/history-*.md` archives (see the Document Map at the bottom of `projectOverview.md`) — only open those when you need history.
- **Also at session start, read `error_events` in production** — it is the only view of faults that never reach a human. **It DOES prune at 30 days — the 2026-09-01 amendment claiming otherwise was wrong and is retracted (BF-93).** The `DELETE` is in `insertErrorEvent` (`lib/data/postgres/adapter.ts`), throttled to once a day by the shared `shouldPrune`, and it has been there since the initial public snapshot. **The evidence that convinced a session otherwise is what a working prune looks like:** a prune fired from a write path only runs when something is written, and errors are now rare, so the oldest row ages past 30 days between faults. Measured 2026-09-01 — last write **2026-08-30**, oldest row **2026-07-31**, span **exactly 30 days**, matching the cutoff computed from the last write to the day. Reading "oldest row is 32 days old" against *today* rather than against the *last write* is what produced the false finding. So: read the table early, because a fault that stops on its own goes unnoticed and then expires. The table is the second-largest object in the database at 52 MB, which is 30 days of retained payload rather than unbounded growth. The first read of that table (2026-08-04) found three faults, **two of which had already stopped before anyone looked**. One query via the admin endpoint:
  ```
  curl -sX POST https://trainingai-production.up.railway.app/api/admin/db-query \
    -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
    -d '{"sql":"SELECT url, source, left(message,120) AS message, count(*) AS hits, max(created_at) AS latest FROM claude_ro.error_events WHERE created_at > now() - interval '"'"'7 days'"'"' GROUP BY 1,2,3 ORDER BY hits DESC LIMIT 30"}'
  ```
  Anything new gets a `projectOverview.md` Known-Issues row or a backlog entry the same session — per **No orphaned findings**, a fault you saw and did not record is a dropped finding. *Something that stopped is not something that was fixed*: record it as unexplained rather than closed.
- **Also at session start, read the database size** — one query, same endpoint, beside the `error_events` read:
  ```
  curl -sX POST https://trainingai-production.up.railway.app/api/admin/db-query \
    -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
    -d '{"sql":"SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) total, pg_size_pretty(pg_relation_size(relid)) heap, pg_size_pretty(pg_indexes_size(relid)) idx FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10"}'
  ```
  **`pg_stat_user_tables` is NOT row-scoped** — unlike every `claude_ro` view it reports physical sizes and
  lifetime counters for the whole database, so these numbers are complete rather than "the owner's, recently".
  **But its SIZE columns and its ROW columns are not equally trustworthy, and conflating them cost a
  session (2026-08-19/20).** `pg_total_relation_size`/`pg_relation_size`/`pg_indexes_size` are read from
  the filesystem and are exact. **`n_live_tup`/`n_dead_tup` are planner ESTIMATES** maintained by
  autovacuum and `ANALYZE`, so they can be arbitrarily stale. Measured 2026-08-20: `n_live_tup` read
  **0** against `oura_raw_packed`'s **764** real rows, and **1** against an `oura_daily_summary`
  holding **45** — the latter was filed as a data-loss incident (Q-528) that had never happened.
  **⚠ The reason this line used to give — that `last_analyze`/`last_autovacuum` are "NULL on every
  table" — was true on 2026-08-20 and is FALSE now (BF-106, 2026-09-01), which makes the rule more
  dangerous rather than less.** Autovacuum and autoanalyze do run on the high-churn tables:
  `oura_raw_samples` autoanalyzed at 20:17 that day and its `n_live_tup` of **191,454** matched
  `count(*)` exactly. Coverage is **partial**, not restored — `oura_raw_packed`, which autoanalyze has
  not reached, still read **55** against **1,051** real rows in the same query. So an accurate reading
  on one table is no evidence about the next one, and nothing in the output tells you which side a
  table is on. **To ask whether a table is empty, run `count(*)`;** where the worry is that a `claude_ro` view hides other users' rows, write the
  finding as "none of the owner's" rather than reaching for a counter that cannot see them either.
  **Baseline: 171 MB total on 2026-08-18**, after the packing work took `oura_raw_samples` from 563 MB to
  50 MB. Growth should now be ~0.4 MB/day. Anything materially above that trend gets a Known-Issues row the
  same session.
  **This check exists because nothing else will tell you.** Storage is billed on *use*, not provisioned size
  (Railway: *"only charged for the amount of storage used"*), at **$0.15/GB/month** — so even the 805 MB peak
  during the 2026-08-17 `disk_full` outage cost about **twelve cents a month**. **Cost will never warn you
  about a storage problem here.** What used to warn was the 500 MB volume hitting `disk_full`; the volume is
  now 5 GB and cannot be shrunk back (Railway does not support down-sizing), so that tripwire is gone and this
  read replaces it. Read `total` **and** `idx` — the 2026-08-17 outage was 306 MB of *index and dead-tuple
  bloat* from a non-HOT re-stamp, with the live row count going **down** and the payload unchanged, so a
  size jump is at least as likely to be bloat as data.
  **What this query can and cannot tell you (2026-08-09 — this trap was walked into):** `claude_ro.error_events` is **row-scoped to one user**, like every `claude_ro` view. A read that returned **383 rows** was against a table holding **7,331**. So every count from this endpoint is *the owner's faults only*, on top of the 30-day prune — two separate floors stacked. Write findings as "nothing else **of the owner's**", never "nothing else is failing"; the second is a claim about other people's accounts that this endpoint structurally cannot support. When a count needs to be system-wide, `pg_stat_user_tables.n_live_tup` gives the real row total without exposing anyone's rows.
- **Working in one area of the app? Read that pillar's index first — [`docs/domains/`](docs/domains/README.md).** The docs are otherwise organised by *document type* (plans, specs, reviews, journal entries, handoffs), so knowledge about one subject is spread across a dozen folders. `docs/domains/<pillar>/README.md` is the subject-based view: what the pillar owns, where its code lives, every reference doc about it, its open known issues, and the handoffs/reviews that already covered it. The eleven pillars are `sleep` · `readiness` · `heart-rate` · `cardio` · `activity` · `workouts` · `nutrition` · `body` · `devices` · `app-shell` · `platform`; [`docs/domains/README.md`](docs/domains/README.md) holds the boundary/routing rules for topics that could sit in two of them. Domain tags are **greppable on purpose**: every `projectOverview.md` Known-Issues heading carries them (`grep -n '^### .*\[sleep\]' projectOverview.md`) and every handoff filename carries one (`ls docs/handoff-*-sleep-*.md`). When you add a reference doc for a pillar, link it from that pillar's index in the same PR.
- **Before building any new feature or shared helper, check [`docs/module-map.md`](docs/module-map.md) first.** It is the "what already exists and where" index of the app's modules and infrastructure — dates, cache, sync/outbox, repository, auth/security, domain formulas, AI, Oura, notifications, UI primitives, and (critically) how recurring/scheduled/background work is done (there is **no cron layer** — see §0 of that file). It exists to stop new work re-implementing infrastructure the app already has. When you add a genuinely new piece of shared infrastructure, add a one-line row to it in the same PR.
- **At the end of every session, fold the journal/index update into the same PR as the implementation** — don't open a separate follow-up PR for it. Write the session summary as **its own new file** in `docs/overview/entries/` named `YYYY-MM-DD-<branch-slug>.md` (per the convention in [`docs/overview/entries/README.md`](docs/overview/entries/README.md)) — **do NOT prepend to a shared `docs/overview/history-*.md`; that shared-line edit was the most frequent multi-PR merge conflict, and per-entry files take it to zero.** A periodic compaction sweep folds these into the batched history later. Also make the `projectOverview.md` lean-index update (current status, any new known issues, what's planned next) as commits on the *same branch* as the code change, once the diff is final and CI is green — i.e. write it last, right before merging (or before auto-merge lands), not speculatively at the start of the session. Because it rides in the same PR, it only ever lands if that PR actually merges — a PR that gets abandoned, superseded, or reworked never leaves a stale "done" claim behind. Keep shared *pointer* lines out of a feature PR (the backlog serial-track "Next on the track" line and `planned_upgrades.md` tick marks defer to the compaction sweep — see the README); striking the completed item's own backlog **queue entry** stays in the feature PR (non-adjacent, rarely conflicts). If user-visible changes were shipped, bump the version in `package.json` and add an entry to `packages/shared/src/changelog.ts` in that same PR — patch for bug fixes, minor for new features, major for breaking changes or large redesigns. (The version/changelog bump still edits shared lines and can conflict on parallel merges — re-bump on rebase; a future changelog-fragment change could remove that too.)
- **Every session carries a status light at the end of its title — 🟢 while it is live, 🔴 once it is
  wrapped.** This is **every** session, not just the six standing agents: an ad-hoc
  `Token usage investigation 🟢` is what tells the owner, scanning the session list, which threads are
  still open and need closing out. Set it early — rename yourself so the title ends in ` 🟢`, via
  `get_session` with `session_id` **omitted** (it describes the calling session and returns your own
  ID in `ccr.id`), then `set_session_title`. Flip it to 🔴 as the last act of the Session Wrap-Up
  below. The standing agents come up 🟢 from their own prompts; everything else sets its own.
- **When the user says the session is wrapping up** — "let's wrap this session", "let's close this session", "we're finishing up", or anything equivalent — that is a request for the three-part wrap-up ritual below (handoff doc → documentation cleanup → next-agent prompt), not just an acknowledgement. See **Session Wrap-Up** immediately after this list.
- **Tick off roadmap items immediately when pushed to `main`** — as soon as any planned feature or fix lands on `main` (even for testing), mark it as ✅ in `projectOverview.md`. If it still needs testing or has known gaps, add a ⚠️ note inline rather than leaving it unchecked. Never leave a shipped item unchecked because it "isn't fully verified yet".
- **Decisions come with a recommendation attached, and cheap reversible ones don't come at all.** Recommendation first, why it wins long-term, alternatives and what each is better at, reversal cost, plain English. Full rule: **Decisions That Come Back To Me**, below.
- **Break things into components** — where possible, split code into smaller components and avoid creating very long files.
- **Keep plan-generation prompts small.** When turning a design spec into an implementation plan (`docs/superpowers/plans/`), don't hand a sub-agent the entire spec plus the full task breakdown in one massive prompt — it can time out. Investigate the relevant files first (small, scoped Explore calls), then write the plan directly. If a spec covers many independent areas (DB/backend, sync, UI, admin), consider splitting it into multiple smaller plan documents rather than one giant one.
- **Backlog-driven implementation — plan now, build later, two PRs total.** New features, upgrades, and non-trivial fixes are split across sessions. **PR 1 (docs-only, planning session):** writes the implementation plan to `docs/superpowers/plans/` and inserts an entry into `docs/implementation-backlog.md` at the priority it judges right (queue position = priority) — it does **not** implement. **PR 2 (implementer session, later):** works the queue top-down following the protocol at the top of the backlog file, implements the change, removes the backlog entry, and appends the journal/`projectOverview.md` update — all in that **one** PR (see the end-of-session rule above); a finished item must never linger in the queue, and the notes must never describe work that isn't in that same diff. Exempt: small fixes the user explicitly asks to have done in-session.
  - **Before implementing, re-verify the plan against current `main`** — plans can go stale while they sit in the queue (the feature got built another way, the code it targets moved, it's no longer needed). If the plan no longer matches reality, don't implement it blindly: reconcile first, and if it's superseded or already done, remove the backlog entry via a docs-only PR with a one-line note on why, instead of forcing a mismatched implementation just to clear the queue.

---

## The Standing Agents — six sessions, one repo

Full contract: [`docs/agents/README.md`](docs/agents/README.md). The rules below are the ones that
must bind even if that file is never opened.

**The roles.** **Orchestrator** owns the queue and the docs — it clears completed entries, assigns
batches, resolves lanes, and reconciles docs against reality on a weekly sweep. **Implementation**
runs in two lanes and is the only role that writes code — Lane A
owns the engine (`lib/data/**` including every migration, `lib/local-store/**`, `lib/sqlite/**`,
`lib/cache-groups.ts`, `app/api/**`, `packages/shared/**` except `changelog.ts`, the domain-math and
device pipelines, auth/security, `android/**`), Lane B owns the surface (`app/**` except
`app/api/**`, `components/**`, `app/globals.css`, `lib/hooks/**`, `lib/stores/**`). **BugFix** turns
owner reports into backlog entries. **Tuning** turns lived feedback into calibration proposals.
**Review** sweeps the running app weekly and files what it finds. Those four end at a docs-only PR
and never write code — which is what keeps the collision surface to Lane A against Lane B.

- **Lane ownership is decided by a rule, not a list.** Reached by `app/api/**` or touching storage
  → Lane A. Reached only from `app/**` or `components/**` → Lane B. Both → Lane A, engine half
  first. The path lists in `docs/agents/README.md` §3 are the obvious cases; they named 28 of the
  ~68 entries under `lib/` and the gap produced a live contradiction, which is why the rule is the
  authority. Where even the rule is ambiguous, the claiming lane records it in its baton first and
  releases the claim when that branch merges.
- **Entry IDs come from your own letter and count up forever — there is no band and no pointer.**
  Lane A `LA-` · Lane B `LB-` · BugFix `BF-` · Review `RV-` · Tuning `TN-` · Orchestrator `OR-` ·
  one-off sessions `PS-`. Find
  your next number with `grep -rhoE '\bRV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`. A shared
  next-free pointer is a floor, not an authority — it cannot see an unmerged PR, which caused six
  collisions in three days and two live duplicates. Reserved bands fixed that and ran out instead
  (Tuning 29 of 30; Review 50 in two days) with a ledger that drifted twice. **The letter records
  who found the item, never who ships it, and never changes** — an entry filed by Review and built
  by Lane A keeps its `RV-`. Legacy `Q-` numbers stay valid and are not renumbered. IDs are
  identifiers, not priorities: priority is queue position, so an `RV-31` above an `LA-12` is correct.
- **An implementer starts from `node scripts/next-item.js --lane <A|B>`, not from a hand-scan.** It
  prints READY in queue order, PARKED with the reason, and UNCLASSIFIED for a `Lane: ?`. Whether the
  top entry is actually startable is exactly what reading the file cannot tell you.
- **`Batch: <slug>` means these entries ship as ONE PR.** Aggregate on what has to be *verified*,
  never on subject: entries name 320 files of which only 39 are shared, and `platform` alone holds
  106 entries, so file and domain are both the wrong axis. CI is free; the owner's attention and the
  device are not. **Never batch a migration or sync-push change** — its revert is a corrective
  migration. Batch native/Kotlin hardest, because each costs an APK cycle and an install can force
  the uninstall that destroys the ring key. A sweep across N files is already a batch: do not split
  it. Assign batches when an entry is next touched, not in a bulk pass.
- **`Needs:` / `Gate:` / `Reference:` are fields, not prose.** `Needs:` names another entry and clears
  when that entry leaves the queue — **an absent target counts as shipped**, because the protocol
  removes completed entries. `Gate:` takes only `owner` or `device`. **`Reference:` marks an entry other
  entries READ rather than build**, so it prints in its own section, never heading the work list.
  `check-backlog-pointers.js` enforces all of it — cycles, an invented `Needs:`, a prose-only reference.
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
- **A finished entry must not still be in the queue, and it is now checked.**
  `check-backlog-pointers.js` fails on a NEW queue heading containing ✅/SHIPPED/FIXED/RESOLVED and
  similar; the 17 that already did are baselined shrink-only, and clearing them is Orchestrator's
  first sweep. An entry genuinely still owing an owner or device check states so with
  `- **Keep:** <what is owed>` rather than being deleted or left to look finished.
- **The session titles are fixed, and a successor reuses its predecessor's exactly** — `🚧 Implementation
  Agent (A) 🟢` · `🚧 Implementation Agent (B) 🟢` · `🪲 BugFix Intake Agent 🟢` · `🎶 Tuning Agent 🟢` ·
  `📖 Review Agent 🟢` · `🪐 Orchestrator 🟢`. Leading emoji = role; **trailing = this session's status, and
  the outgoing session flips 🟢 to 🔴 as its last act** so the owner archives the reds. A renamed successor
  is a lost thread even with a perfect baton; every handoff states its successor's title outright.
- **Handing over:** land everything first — the container is ephemeral, so an uncommitted baton is a
  lost baton — then **rewrite** `docs/agents/state/<agent>.md` in full. Never append; a baton that is
  half last week's is worse than none, because it gets trusted. The dated
  `docs/handoff-YYYY-MM-DD-<domain>-<title>.md` still carries the narrative when a cluster closes;
  the baton carries state only, which is what stops it accreting.

---

## Session Wrap-Up — what "let's close this session" means

**Trigger:** the user signals the session is ending — *"let's wrap this session"*, *"let's close this
session"*, *"we're finishing up"*, *"wrap it up"*, or any equivalent. Treat it as a standing
instruction to do all four steps below, in order, without being asked for each one. Do them even if
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

**4. Flip the session's status light to 🔴.**
Rename the session so its title ends in 🔴 rather than 🟢 — the same two calls as above. Do it last,
once steps 1–3 have landed and pushed. A session still showing 🟢 after its wrap-up reads as live,
and the owner has to re-open it to find out otherwise.

**Steps 1–3 land in a commit on the working branch and get pushed** (docs-only, so it merges with
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

**Three CI-monitoring gotchas that cost a session each:** (1) a bash `curl` to `api.github.com` using `$GITHUB_TOKEN` is **not authenticated** in this environment — it's a non-authenticating proxy placeholder, and reading its silence/failure as "still running" or "still green" is wrong. Always use the GitHub MCP tools (`get_check_run`, `get_job_logs`, etc.), never bash `curl`, to check CI/PR state. (2) A check run that fails in 2–3 seconds with **no logs at all** is a transient GitHub Actions startup blip, not a real failure — re-trigger it with an empty commit rather than diagnosing a failure that has no evidence. (3) **`get_check_runs` can lag reality by 30+ minutes, and a job's logs 404 for exactly as long — so "still in progress" is not evidence that anything is stuck.** Measured 2026-08-17 (PR #20): `Tests` read `in_progress` for ~25 min after it had completed at 06:39:36, and `Lint` — a 43-second job — read `in_progress` for ~35 min. Log fetches returned HTTP 404 throughout, which looks like confirmation of a running job and is not. Two hours went into diagnosing a stall that never existed, including one pointless empty-commit re-trigger. **The reliable green check is attempting the merge**: `merge_pull_request` validates against real branch-protection state, so it succeeds if the required checks actually passed and refuses with the reason if they did not — it cannot merge a genuinely pending check. When the checks endpoint looks frozen, stop polling it and try the merge. To tell a slow job from a stale read, compare **job-level `started_at`/`completed_at` per step** from `list_workflow_jobs` on a recent run, never the run's `updated_at` (which is itself stale — it read 9 seconds after start on a run that had been going an hour).

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
- **Invalidating a key and re-rendering the component that reads it are two different things.** A component reading a cached key uses **`useCachedValue(key, url, ttl)`** (`lib/hooks/use-cached-value.ts`), never a hand-rolled `useEffect(() => { cachedFetch(…) }, [])` — that shape never re-runs, so anything in the **persistent tab shell** (it does not unmount) holds its first payload until the app is killed. Home's energy-balance card did exactly that and the owner reported it as "requires a restart of the app" (Q-402), while all six write groups were evicting the key correctly the whole time. The signal is `subscribeToInvalidation` in `lib/sqlite/cache.ts`, and `useCachedValue` takes an `onError` because `cachedFetch` swallows `!res.ok`. **Do not reach for a shorter TTL** — an effect that never runs never consults one; it adds load and hides the defect. `scripts/check-fetch-once-effects.js` freezes the 36 remaining sites (Q-359, shrink-only per file): **19 are permanently mounted and can bite**, 1 is a deliberate warm pass, 16 unmount and are latent. Judge a site by where it is MOUNTED, not by its filename — the tab screens render their sheets unconditionally with a null prop, so a "sheet" is usually persistent here too.
- Any cache holding "today's" data must embed the local date in its key (or validate the date on read) — a 30-min TTL happily serves yesterday's data across midnight (session 52).
- Client GETs of `/api/*` use `cachedFetch` with a `readCacheSync` seed, never bare `fetch`. Before adding a cache key, grep for an existing key for the same endpoint and reuse it — duplicate keys for the same data cause stale/blank first paints.
- After an optimistic local write, never apply or **cache** a server response that would replace it with null/absent data (the mood-checkin re-prompt and rest-day revert bugs, session 167). Invalidate caches **before** firing refetch callbacks (session 164). Submit/complete buttons need an in-flight guard — 5 rapid taps once fired 4 `complete-workout` POSTs (session 86).
- When replacing or renaming a cache/seed key, delete the legacy key from **every seed site** and add it to the invalidation groups in the same PR. A stale legacy seed re-paints pre-write state: `ta_recommendation_v1`/`ta_meta_v1` survive `invalidateWorkoutSummaries()`, which is why completing a workout looked slow — home re-painted the pre-workout recommendation until the network caught up (audit 2026-07-02); both are cleared via the shared `clearLegacyHomeSeeds()` helper in `lib/cache-groups.ts`, called from both `invalidateWorkoutSummaries()` and `invalidateProgramStructure()` (session 271 — `invalidateProgramStructure()` previously missed them, re-painting the pre-edit session list/recommendation after a Config save). `ta_streak_v1`/`ta_calendar_v2_*`, previously listed here, are verified dead in source (session 271) — no remaining seed sites.
- **One canonical TTL per cache key.** The same key fetched with different TTLs at different call sites makes freshness last-writer-wins. Define the TTL once, in `packages/shared/src/cache-ttl.ts`, next to the key — any key fetched at ≥2 sites gets a named constant there. (`readiness-score` used to be the counter-example, fetched with SHORT, MEDIUM *and* LONG — audit 2026-07-02. **Re-checked 2026-08-03: fixed.** `READINESS_SCORE_TTL` is defined once in `packages/shared/src/cache-ttl.ts` and every one of its fetch/warm sites uses it. It is now the *reference* for this rule, not the violation.) **`scripts/check-cache-ttl-divergence.js` enforces it in the Custom Rules job** (added 2026-08-14, Q-242) — it compares TTL *expressions*, not resolved values, across `cachedFetch`/`cachedFetchToday`/`setCached` call sites **and the sync-provider warm list**, because two names for the same number today are exactly what drifts tomorrow. Prose alone did not hold it: at the time the check was written, `day-log:` carried two expressions with equal values and `hr-profile` carried two with **different** ones (6 h at seven sites, 30 min at the eighth). Its blind spot is a key built by a helper call, which cannot be resolved statically — the run prints how many such sites it skipped, so a clean run is never mistaken for full coverage.
- **API responses are `Cache-Control: private, no-store` — never `max-age`/`stale-while-revalidate`.** This app manages freshness itself, through cache keys and the named invalidation groups above; an HTTP-cache header puts a **second** cache underneath all of it, and it is the only one `invalidateCache()` cannot reach. **This reverses the old "new aggregate GET routes ship SWR headers at creation" rule** (2026-08-10, owner decision on Q-166), which stood from session 177 until the header's effect was measured rather than assumed: it had already caused a live stale-delete bug (see the bypass rule below), and with both `cachedFetch` and the service worker sending `cache: 'no-store'` it governs almost nothing on the canonical runtime. `scripts/check-api-no-store.js` fails the Custom Rules check on any `max-age`/`s-maxage`/`stale-while-revalidate`/`stale-if-error`/`immutable` in an `app/api` route. One exemption, listed in the script with its reason: `/api/version`, which is public and session-independent. If you believe a new route needs a real cache header, add it to that list with a written reason — do not delete the check.
- **One fetch variant per key** — a key is either always `cachedFetch` or always `cachedFetchToday`, never both. Converting one means converting every read site *and the sync-provider warm list* in the same commit (the weekly-stats crash).
- **What makes an invalidation load-bearing — check this, don't assume it (Q-262, measured 2026-08-16).** `cachedFetchCore` paints the cached value and then **always** revalidates over the network, so a stale entry can only survive as a *settled* value in two cases: **(a)** a call site passes `freshWithinTtl: true`, or **(b)** a read path is **seed-only** — a screen that `readCacheSync`s the key and never fetches it (the Q-260 shape). Where neither holds, the entry is a first-paint accelerator and clearing it changes nothing except replacing a briefly-stale paint with a blank one — which the instant-paint rule below calls the worse outcome, and which is strictly worse offline, where `cachedFetch` cannot revalidate at all. **This does not license skipping invalidation:** keep writing through the named groups, because a key that is inert today becomes load-bearing the moment someone adds `freshWithinTtl` to it. It licenses *knowing which half of the rule is protecting you* — and it means a stale-value bug report is more often condition (b), a read path with no fetch, than a missed group entry. Audited for one group: all six keys of `invalidateGoalRecommendations()` are inert, [`docs/reviews/2026-08-16-goal-invalidation-audit.md`](docs/reviews/2026-08-16-goal-invalidation-audit.md). The other groups are **not** audited and `cache-groups.ts`'s own comments flag `freshWithinTtl` keys inside them.
- **`freshWithinTtl: true` requires a written invalidation proof**: list every write that changes the payload and show each one's group contains the key. A missed writer converts a stale flash into hours of hard staleness. A today-guard on the cache seed isn't enough on its own — the `cachedFetch` onData hit path needs the same guard, or use `cachedFetchToday`.
- **Never create a bare key that's a prefix-sibling of an existing group prefix** (e.g. `health-trends` vs `health-trends:`) — prefix invalidation silently misses it.
- **Every `/api/*` read bypasses the browser HTTP cache — keep it that way.** `cachedFetch` sends `cache: 'no-store'` and the service worker's `/api/` branch (`public/sw-template.js`) does too. That layer sits *underneath* the cache groups above and is the only cache `invalidateCache()` cannot reach, so a route's `Cache-Control: private, max-age=60` otherwise re-serves pre-write data. **Measured 2026-08-09:** an unsafe method only invalidates its *own* URL, so `POST /api/phase-sets` → `GET /api/phase-sets` self-heals while `DELETE /api/supplements/<id>` → `GET /api/supplements` kept returning the deleted row for a minute — on a route already shipping the header. If you add a new client fetch helper, it needs the same bypass. **That measurement is what retired the old SWR-header rule** — see the `private, no-store` rule above (Q-166, decided 2026-08-10). The two are independent guarantees and both stay: the routes no longer ask to be cached, *and* the client refuses to read from that cache. Keep the bypass even though the headers are gone — it is free, and it is the half that holds for a response from a route that regains a header.

---


## Data Layer Rules — Sync, Migrations, Stored Counters

Offline-sync write-path mirroring, local SQLite migration safety, Postgres seed-vs-drift rules,
stored-counter derivation, and the "a correlation across a model change is not evidence" trap all
moved to [`docs/data-layer-rules.md`](docs/data-layer-rules.md) — mostly Lane A's territory
(`lib/data/**`, `lib/local-store/**`, `app/api/**`) per the standing-agents lane split. The single
rule worth carrying even into UI-only work: **a server hard DELETE is invisible to devices that
haven't synced** — any domain with delete UI needs a `deleted_at` tombstone, or cross-device deletes
silently don't propagate.

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
  [`docs/canonical-runtime-android.md`](docs/canonical-runtime-android.md) "Getting a new APK"
  (download `apk-latest`; a local Gradle build is the fallback, not the default). JS/server changes
  ship via Railway into the WebView with no rebuild at all. State which half a PR touches.
  On-device is the only real verification for any BLE behaviour.

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
- **Deriving BOTH sides from the clock is not enough if they come from different timezones** (Q-356,
  2026-08-18). `periodization-soft-delete.test.ts` inserted at `now() - interval '2 hours'` — a UTC
  offset — and queried a window derived from the *user's* timezone. Between 00:00 and 02:00 Brisbane
  (14:00–16:00 UTC) "two hours ago" is the previous local day, so the row fell outside the window and
  **the whole file went red, 21 of 21, on every branch, for two hours every day**. It survived weeks
  because it only fired in that window. Two correct shapes: compute the user-local day **first** and
  anchor the fixture to **midday on that day** (midnight is a boundary, and a boundary is where an
  off-by-one stops being visible), or read the local day **back from the row you just inserted**, as
  `oura-workout-soft-delete.test.ts` does. And a regression test for this class must not wait for the
  window — pick a fixed-offset zone (`Etc/GMT±N`) whose local time is *currently* near 01:00 and run
  the case there, so it fires on every CI run. `faketime` does not help: it shifts node's clock, not
  Postgres's.
- **`aestMidnight(y, m, d)` without its fourth argument keys the window to Brisbane, for every
  user.** The parameter exists and defaults to `DEFAULT_TZ`, which is right for the owner and wrong
  for everyone else — the same "a default every caller overrides is a safety net" shape as the repo
  day-window helpers below. It was **9 of 22** on 2026-08-23; all 22 pass one now (LA-19), and
  `scripts/check-aest-midnight-timezone.js` holds that at zero in the Custom Rules job — its
  baseline is **empty**, so an omitting call site is a regression rather than a debt row. It surfaced from a test that was written correctly — it read the local day
  back from the row it had inserted — and still failed, because the query re-derived midnight in
  Brisbane. **To find this class, do not read: shift a test user's timezone into its own 00:00–02:00
  band** (an `Etc/GMT±N` computed from the current UTC hour, as
  `local-day-fixture-anchoring.test.ts` does) and re-run. That reproduces the hazard on any clock,
  which is the whole reason it survives otherwise.
- **Client code has two "today" sources** — `todayInTz()` vs the device's own timezone. Pick one per feature and don't mix them for keys that must match server bucketing. Repo day-window helpers (`getCalendarData`, `getRecentTrainedDays`, `getNextSession`) take `timezone = DEFAULT_TZ` as a **default parameter** and every current caller passes the session tz — they are the pattern to copy, not a known-broken area (Q-480). Keep threading it when touching them: a default every caller overrides is a safety net, and it is what makes forgetting silent. Never re-declare `DEFAULT_TZ` locally.

---


## Mobile UI & Performance (S25 Ultra — the only real target)

Full rules (safe-area floored-utility clearance, instant-paint cache seeding, save-feels-instant,
render/memo discipline, touch & gesture direction-locking, dark-only theming, Zustand rehydration
safety, Android WebView compositor gotchas) moved to
[`docs/mobile-ui-and-performance.md`](docs/mobile-ui-and-performance.md) — the `ui-ux-pro-max`
skill enforces it directly for any screen/component work. The three costliest recurring mistakes,
kept here because they're cheap to state and expensive to relearn:
- **Bare `pb-safe`/`env(safe-area-inset-bottom)` gives near-zero clearance on Android gesture-nav**
  — any bottom-anchored action row/button uses a FLOORED utility (`pb-safe-action` /
  `pb-safe-action-lg`), never bare `pb-safe`, or it sits on the gesture bar.
- **A skeleton flash on a repeat visit is a bug** — seed every fetch synchronously from cache
  (`readCacheSync`) in a `useEffect` (never a `useState` initializer) and revalidate in the
  background.
- **`React.memo` only works with stable props** — one inline arrow/object literal at the call site
  defeats it silently while the component still reads as optimised.

## AI & Security Defaults

- Every LLM call returning structured data uses `generateObject`/a response schema — never `JSON.parse` of free text. Keep it that way: prose-only `generateText` routes must never grow a `JSON.parse` of model text, and every `generateText`/`streamText` call is wrapped in try-catch returning a JSON error (`health-insight` and `weekly-digest` once shipped without). Deterministic math lives in code: no LLM self-reported number (confidence, totals) may gate an automatic action **or be shown to the user as fact** — a model handed a score of 80 called it *"perfect"* twice (Q-292), which gates nothing and is read as true. Prose routes import `PROSE_GUARDS` (`lib/ai/prompt-guards.ts`): quote the given numbers, no superlatives, metric units only.
- Security checks fail **closed**: a missing signature header, missing signing key, or oversized/mistyped input is a rejection, not a skip (the Oura webhook once skipped verification when the header was absent).
- **Write-path ownership discipline (this bug class recurred across 3 domains — 2026-07-06 review):**
  (a) after a user-scoped UPDATE whose row id came from the client, **check the affected-row count** before any dependent child write — a 0-row match followed by an unscoped `DELETE … WHERE parent_id = id` + re-insert is a cross-user wipe (the `saveProgressionStyle`/`updateSavedMeal` class);
  (b) **never pass a raw request body into Drizzle `.set()`** — `userId`/`deletedAt`/`createdAt` are settable column keys and the TypeScript `Omit<>` is compile-time only; Zod-whitelist every PATCH/PUT body at creation (`updateInjury` is the reference);
  (c) **client-supplied row ids in upserts must be ownership-verified even when the table has no `user_id` column** — pre-check via a join to the owning table (exercise/set logs → `workout_sessions`), exactly as `ensureWorkoutSession` does for session ids.
- **Webhooks verify signatures before any DB lookup keyed on unverified payload fields.** The lookup itself (e.g. a per-user signing key) can't always be avoided, but the *response* must not diverge before verification completes — branching to a different status code for "user not found" vs "bad signature" is an enumeration oracle. Look the user up, but let verification (which already fails closed on an undefined key) produce the response.
- **Ingest routes get a Zod schema at creation**, same as sibling routes — untyped numeric passthrough to the driver is not validation.
- **Self-fetching cards need an explicit failure state** — `cachedFetch`/`useCachedValue` swallow `!res.ok`, including your own rate limit, *unless the caller passes `onError`*; a bare `return null` with no `onError` makes the card vanish silently instead of showing an error state (Q-499).
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

**The inverse rule, which is the one that actually broke (Q-488, 2026-08-18): a domain the UI reads local-first must have EVERY write update the local store — deletes included, and including a write made from a screen that itself reads server-side.** That last clause is why it hid: `health-content.tsx` deleted an activity through the API only, and its own screen reads the server-assembled `day-log:` aggregate, so the row vanished there instantly while three local-first surfaces kept showing it until the next pull (throttled to 5 minutes and never forced by that path). Nothing on the originating screen could reveal it. Every other mutating write to a local-first domain was audited and all eight write locally; this was the only one.

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

**Policy:** the app's single canonical, supported runtime is the APK on the Samsung S25 Ultra. The
web build exists solely as a dev/QA surface (`pnpm dev` pre-merge testing) and must stay logic-free
(pure fetch → render pass-through, no defaults/derivations/write semantics the device path lacks).
**When behaviour must diverge, the device wins** — never add web-only product features. Full
signing/release mechanics, the local Gradle build fallback, and — most importantly — the
uninstall/ring-key recovery warning (an uninstall destroys the Oura ring's BLE key, which is **not**
recoverable from this repo, the server, or any log) now live in
[`docs/canonical-runtime-android.md`](docs/canonical-runtime-android.md) — **read it before any
uninstall, and before touching `android/**`, `capacitor.config.ts`, or cutting a release.**

**Most changes need no APK at all.** The APK is a WebView loading the app from Railway
(`capacitor.config.ts` `server.url`), so JS/TypeScript/server changes under `lib/`, `app/`,
`components/`, `packages/` reach the device through a normal Railway deploy — merging *is* the
delivery. Only `android/**` (Kotlin), `capacitor.config.ts`, or a dependency change needs a new
APK; when one does, download the CI-published rolling release (see the doc) rather than building
locally.

**Green `pnpm dev` is necessary, never sufficient.** For any change touching an offline-first
domain, a native plugin, safe-area, gestures, or notifications, the merge gate is the on-device
smoke run (`docs/device-smoke-checklist.md`) — or, when no device is available in-session, an
explicit Known-Issues row in `projectOverview.md` marking the change NOT verified on device.

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
- **An entry ID cannot collide across agents any more, but it still can within one role.** Each agent counts up from its own letter, so Lane A and Review cannot take the same number by construction. What no allocation scheme prevents is two sessions of the *same* role running at once and not seeing each other's unmerged PR — that has happened, and once cost a whole PR's work when two sessions ran the same compaction chore. `scripts/check-backlog-pointers.js` fails CI on a duplicate ID, so it surfaces at review rather than living in the queue; resolve one by appending a letter (the second `RV-14` becomes `RV-14a`).
- **On `docs/implementation-backlog.md`, a conflict is almost always TWO DELETIONS — keep neither side.** Each PR removes the entry it finished, so when two land together the markers wrap *different completed entries*, and "keep both" restores both. That is not hypothetical, and **it has now happened three times**: it silently put **LB-4, Q-454, Q-455 and Q-465 back into the queue after they shipped** on 2026-08-23, they were removed in #348 the same day — and **LB-4 came back again four commits later in #349**, from a branch cut before #348 landed. A rule cannot reach a branch that predates it, which is the argument for the check rather than against the rule. The inverse holds on append-only files (`known-issues-resolved.md`, `doc-size-baseline-history.md`), where a conflict is two *additions* and keeping both is right. **The doc-size baselines no longer conflict at all** — LA-33 split the shared map into one `docs/doc-size/<path>.size` file per tracked doc, so two PRs raising two different documents touch no common line; two raising the *same* document still conflict, which is correct, because they genuinely disagree about one number. **The two cases look identical from the marker alone — read the headings before choosing.**
  **`check-backlog-pointers.js` now fails on a queue heading with NOTHING under it**, which is the shape all three resurrections took — a real entry always carries a `Branch:`/`Added:` bullet, so there are no false positives to weigh. It is deliberately narrower than the class: a resurrection that restores a *full* entry still passes. The obvious general check was measured and rejected — 25 ids sit in both a queue heading and a journal title today and most are legitimate (an entry that shipped half its work stays queued with a `Keep:` line) — and the version that would work wants git history (*was this id ever deleted from the backlog on `main`?*), which CI cannot answer while it checks out at depth 1.
- **Resolve `package.json` / `changelog.ts` conflicts by rebuilding from `origin/main`, not by splicing the conflict hunks.** When the conflict falls *inside* an entry's `changes:` array — which it does whenever two PRs bump on the same day — both sides share the `version:`/`date:` header above the marker, so a naive splice produces an entry with no header and silently drops the other PR's version. This corrupted the changelog twice on 2026-08-08 before the approach changed. The reliable shape: take `git show origin/main:packages/shared/src/changelog.ts`, prepend your entry at the next free number, and write the whole file.
- **In a session that merges several PRs in a row, "freshly fetched" goes stale while you work — re-merge `main` immediately BEFORE opening each PR, not just before creating the branch.** This bit three times in one session on 2026-08-04 (#1052, #1056→#1060 twice) *while the rule above was being followed correctly every time*: the branch was cut from a genuinely current `main`, then an earlier PR of the same session merged, and by the time this one opened its base was behind. You cannot fetch a commit that does not exist yet, so the rule above cannot prevent it. **The tell is distinctive and worth learning: `get_check_runs` returning `total_count: 0` several minutes after opening a PR is a stale base, not slow CI** — real CI reports queued/in-progress checks within about a minute. The fix is `git fetch origin main && git merge origin/main`, resolve, push; checks start immediately. Do not sit waiting on a monitor for checks that will never arrive.

---

## Decisions That Come Back To Me — answer the whole question the first time

**First, don't ask.** A decision is the owner's only if it is **hard to reverse** (migration, auth,
external contract, public surface), **expensive to reverse** (it seeds a pattern the codebase will
copy), or a **genuine preference** not derivable from the repo. Everything else — naming, file
layout, which primitive to reuse, two equivalent implementations — you decide, state in one line what
you picked and why, and continue. Asking about a cheap reversible choice is not caution; it hands the
work back.

**When it genuinely is the owner's, never send a bare question.** The owner should not have to reply
*"give me the options with your recommendation and why, the alternatives and why not, the
best-practice future-proof answer rather than a quick fix, in plain English"* — that is the default
shape of every decision you bring, produced unasked:

1. **The recommendation, first line.** One named option, stated as a recommendation — not a menu.
2. **Why, framed a year out.** What it costs to live with and what it makes easy later, not what is
   fastest today. Default to the durable option; if you are recommending the quick one, say so
   outright and name the debt.
3. **Alternatives, each with the reason it lost** — and what it would genuinely be *better* at. An
   alternative with no upside is padding, not an option.
4. **Reversal cost.** If this is wrong in three months, what does undoing it take? Cheap-to-reverse
   deserves less deliberation, and saying so often unblocks the decision fastest.
5. **Plain English** — no unexplained jargon or acronyms, no file path standing in for a reason.
   Assume the reader knows the product cold and the internals not at all.

**Keep it under a minute's reading** (~15 lines). A brief longer than the work has failed. Use
`AskUserQuestion` for discrete short options, prose when the reasoning is the thing to read. **Never
manufacture a trade-off** — if one option is genuinely the only sane one, say that and proceed.
**Override:** "quick fix" / "temporary" / "spike" / "don't over-think it" flips the bias to speed for
that task, with the durable version noted in one line so the debt is on the record.

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

The user wears an **Oura Ring 5**, read directly over BLE — see **Oura Direct-BLE** above, the live
pipeline and the only one. The Oura *Cloud* integration was removed on 2026-08-13 and must never be
re-added (it can't succeed — the ring is on our key — and re-onboarding the official app risks a
firmware update that breaks the reverse-engineered protocol). What's deliberately kept (historical
Cloud data, the ranked per-field health-write merge, the six still-local `app/api/oura/*` routes)
and the full reasoning now live in
[`docs/oura-ble-operations.md`](docs/oura-ble-operations.md#6-oura-cloud-retirement--whats-gone-whats-kept-and-why-owner-2026-08-13)
§6, merged there with the rest of the Oura pipeline's standing rules.

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

A local Postgres 16 instance auto-provisions at session start (`.claude/hooks/session-start.sh` →
`scripts/local-db/setup.sh`) — see the session-start output for connection details. Full gotchas
(aged fixtures, pool exhaustion, rate-limit poisoning between runs, hour-dependent test traps, the
DATABASE_URL/DATABASE_SSL override gotcha) are catalogued in
[`docs/local-dev-database.md`](docs/local-dev-database.md) — read it when a local test result looks
wrong or inconsistent with CI rather than trusting the first read.

## Environment Variables

Full reference (every var, what it does, safe-to-remove notes) moved to
[`docs/environment-variables.md`](docs/environment-variables.md) — it's consulted when setting up
or debugging config, not needed for everyday feature work. Required vars: `DATABASE_URL`,
`AUTH_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`,
`GOOGLE_GENERATIVE_AI_API_KEY`, `HEALTH_CONNECT_INGEST_SECRET`, `WEBHOOK_USER_ID`.
