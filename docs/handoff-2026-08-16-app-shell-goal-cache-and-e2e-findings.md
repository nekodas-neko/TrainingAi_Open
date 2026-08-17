# Handoff — 2026-08-16 · the goal/cache cluster, and what the E2E harness found

_Domain: `app-shell` (also touches `platform`, `health`) · Branch: `docs/session-wrap-app-shell` · PRs: #1382, #1383, #1385, #1389, #1392, #1395 — **all merged**_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> [`docs/domains/app-shell/README.md`](domains/app-shell/README.md), then
> [`docs/implementation-backlog.md`](implementation-backlog.md).
> Continues from [`docs/handoff-2026-08-15-app-shell-ia-cluster-complete.md`](handoff-2026-08-15-app-shell-ia-cluster-complete.md),
> which closed the 2026-08-14 IA cluster. This doc covers what came after: the owner-reported
> readiness item, the two owner questions it left open, and the chain of findings the new E2E
> harness produced.

## Goal

Work the app-shell lane to empty: close the two questions the IA cluster left for the owner, then
take the findings the E2E harness surfaced. It turned into a cache/staleness investigation that
corrected two of this project's standing beliefs.

## Current status

- **Build/test:** `tsc` · `pnpm lint` (0 errors) · `pnpm build` · `pnpm check:rules` **36 of 36** ·
  unit suite · full E2E cold on a fresh DB with `--retries=0`. All green at the last merge.
- **Unit-suite counts changed mid-session and it is not a regression:** it now reports
  **476 passed / 2 skipped** (3,885 passed, 54 skipped), not 478/3,939. `main`'s Q-49 A4b work swapped
  the vendor model constants for synthetic fixtures, and the parity tests pinned to the vendor's
  forward pass skip without them. Quote the new numbers.
- **Device-verified: NO.** Nothing this session was exercised on the S25. Two user-visible fixes
  shipped (v1.317.2, v1.317.3) and both are unverified on device — see **Deliberately NOT done**.

## What shipped

| PR | Version | What |
|---|---|---|
| #1382 | — | `e2e/goal-round-trip.spec.ts`; filed Q-258, Q-259, Q-260 |
| #1383 | — | Deleted the three `/sheet/[id]/*` shims (Q-255); More content stays inline (Q-232-followup) |
| #1385 | v1.317.2 | **Q-260 fixed** — Health rendered a stale goal while every source held the new one |
| #1389 | v1.317.3 | **Q-258 fixed** — six goal/body inputs had labels associated with nothing |
| #1392 | — | Q-259 closed as not achievable, with the measurement; filed Q-262 |
| #1395 | — | Q-262 answered — the whole group is inert; one CLAUDE.md rule added; filed Q-263 |

**Q-260 (`app/health/health-content.tsx`, `app/health/use-goal-seeds.ts`)** is the substantive fix.
`user-goals` was fetched by `fetchProgressHealthData` — the Progress tab's group — while the water
goal renders in `waterIntake`, a `BODY_GROUPS` card. A value shown on one tab, fetched only by
another tab's group. Because the shell keeps all five tabs mounted for the app's life, a
`useEffect(…, [])` runs once per launch and nothing ever re-read it. The fetch moved to
`fetchSharedHealthData` (which re-runs on `tabEpoch`), and the localStorage seed moved into
`useGoalSeeds`, which also re-reads on `tabEpoch`.

## Two corrections to standing beliefs — the durable part of this session

**1. Q-240's stated impact was wrong, and it sent two investigations down the wrong path.**
Q-240's entry says a changed goal "renders the old one for 30 minutes". That assumes the cache
short-circuits the fetch. It does not: `cachedFetchCore` paints the cached value and then **always**
revalidates unless the call site passes `freshWithinTtl`. The persistent staleness an owner could
actually hit was Q-260 — a different mechanism with an identical symptom.

**2. `invalidateGoalRecommendations()` is inert for all six of its keys.**
None passes `freshWithinTtl`; none has a seed-only read path. Every `freshWithinTtl` call site in the
app was enumerated to establish it. Full table:
[`docs/reviews/2026-08-16-goal-invalidation-audit.md`](reviews/2026-08-16-goal-invalidation-audit.md).
**No code was deleted** — the group becomes load-bearing the moment anyone adds `freshWithinTtl`, and
the convention that writes go through a named group is worth more than six inert lines.

CLAUDE.md now names the two conditions that make an invalidation matter. **That is an edit to a
strict-rule section and the owner has not reviewed it** — it is additive and explicitly does not
license skipping invalidation, but it is the one change here that shapes how future sessions reason.

## Deliberately NOT done

- **No device verification of anything.** v1.317.2 (goal now reaches Health) and v1.317.3
  (inputs announce their names) are both unverified on the S25. For Q-258 the gap is sharp:
  Playwright resolving `getByLabel` proves the accessible name is wired — the mechanism that was
  broken — but it is not the same as hearing TalkBack announce the field.
- **Sibling surfaces of Q-260 are not swept.** Target weight and body fat ride the same
  seed/`userGoals` pair and are fixed by the same change, but **any other screen reading a value it
  does not re-subscribe to has this exact shape**. The class — mount-scoped state on a screen that
  never unmounts — is bigger than this fix.
- **Only one invalidation group was audited.** The others are *not* expected to match; Q-263.
- **The blank-first-paint consequence is reasoned, not reproduced.** It follows from `readCacheSync`
  returning null after an invalidation, and the offline case from `cachedFetch` having no fallback.
  The settled-value claim, which the audit turns on, is both static and measured.

## Key decisions (with rationale)

- **`/sheet/[id]/*` deleted** — owner confirmed no external bookmark uses them. Re-verified zero
  in-app referrers on current `main` rather than trusting the entry, and exercised all four URLs on a
  dev server (404) plus their live targets.
- **More content stays inline** (Stats, Trophy Case, Achievements, "Your Year", Goals). The IA plan's
  §2 table wanted rows; the size pressure that justified the other splits is gone and these are
  *content*, not navigation. **The plan file itself is annotated superseded for rows 2–7** — without
  that a future session re-derives the move from a table that still reads like a target.
- **The invalidation group was not deleted** despite being inert. See above.
- **`useGoalSeeds` was extracted because the size gate forced it**, not by design instinct. The first
  Q-260 fix pushed `health-content.tsx` 929 → 941 lines; the baseline is shrink-only and raising it
  for a known hotspot is not an option. File is now 911, baseline lowered to match.

## Gotchas / what did NOT work

- **Two of my own findings were wrong and only re-checking caught them.**
  (a) A "Health leaves two cards in a permanent skeleton" finding was **withdrawn** — measured against
  the viewport rather than Playwright's `:visible`, both sit at `left: -379` / `left: 445` in a 412 px
  viewport: off-screen `SwipeCarousel` panels, fetched on swipe by design. **`:visible` means "has a
  box and is not `display:none`", not "on screen".**
  (b) A stale-goal race was twice diagnosed as a test problem before instrumenting proved the app was
  wrong.
- **Three attempts at a Q-240 guard, none of which is one.** Two were mislabelled; the third was
  measured and closed. A guard that has only ever passed proves nothing — mutate before believing.
- **`get_check_runs` returning `total_count: 0` is a stale base, not slow CI.** Hit twice. Fix is
  merge `origin/main` and push; checks start immediately. But **check base drift first** — once it
  was just the registration window.
- **Bash `curl` to `api.github.com` is unauthenticated here.** A monitor built on it returned nothing
  and wasted a cycle. Use the GitHub MCP tools.
- **`pkill -f "next dev"` / `"next-server"` matches the shell running it** and kills the session's own
  command (exit 144). Kill by PID from `ps -eo pid,cmd`.
- **A spec that passes on its retry is not passing.** Run cold with `--retries=0` to see it.
- **Two whole pieces of work were built and discarded as duplicates** of the other lane (Q-248 and a
  complete E2E harness). The Q-number reservation worked; work reservation did not. **Check
  `list_pull_requests` before starting, not just the backlog.**

## Files to look at

- `app/health/health-content.tsx` + `app/health/use-goal-seeds.ts` — the Q-260 fix and the tab-epoch
  re-read pattern.
- `e2e/goal-round-trip.spec.ts` and `e2e/goal-invalidation.spec.ts` — both headers carry measurements
  that explain why they are *not* the guards they look like.
- [`docs/reviews/2026-08-16-goal-invalidation-audit.md`](reviews/2026-08-16-goal-invalidation-audit.md) — the per-key table and the method for Q-263.
- `lib/sqlite/cache.ts` → `cachedFetchCore` — the always-revalidate behaviour everything above turns on.

## Carrying this to the public repo

The public snapshot has been pushed (#1399) and the cut is at Phase B —
[`docs/handoff-2026-08-16-platform-public-repo-cut-a4b.md`](handoff-2026-08-16-platform-public-repo-cut-a4b.md)
and [`docs/public-repo-cut-runbook.md`](public-repo-cut-runbook.md) own that work. Nothing in this
session's cluster is Oura-adjacent or vendor-coupled, so **all of it carries over unmodified**: the
code changes, both E2E specs, the audit, and the CLAUDE.md rule.

Two things to keep intact on the other side, because they are easy to lose in a re-cut:

1. **The measurements embedded in spec headers.** `goal-round-trip.spec.ts` and
   `goal-invalidation.spec.ts` each explain why they are not Q-240 guards. Strip those comments and
   the next session re-runs the same three failed attempts.
2. **The E2E harness's "what a green run does not prove" section** (`e2e/README.md`). It is the only
   thing standing between a green browser run and someone believing the device path is covered.

## Open questions / blockers

- **The CLAUDE.md rule edit is unreviewed by the owner.** One line in the cache-invalidation section.
  Additive; does not license skipping invalidation. Worth a look because it changes how sessions
  reason about a rule the project calls its most repeated bug class.
- **Q-261** — six `<Label>`s in `components/profile/` front button groups, not controls. `htmlFor`
  cannot fix them; `<Label>` (Radix) may be the wrong element entirely. **Needs a design call.**
- **Q-263** — audit the remaining cache groups. **This is where the load-bearing keys actually are**:
  `cache-groups.ts` already flags `workout-data:all` and `workout-card:<id>` as `freshWithinTtl` keys
  that caused a live bug. The recommended next item.
- **No device is available in these sessions.** Everything above stays device-unverified until the
  owner runs `docs/device-smoke-checklist.md`.

## Pickup prompt

```
You are an implementer session on the TrainingAI repo. Start from a freshly-fetched main:
`git fetch origin main && git remote prune origin && git checkout -B <branch> origin/main`.
Never push to main — everything reaches it through a PR with all six checks green
(Lint, Tests, Build, Custom Rules, Migration Check, E2E).

Read in this order: `projectOverview.md`, `docs/domains/app-shell/README.md`,
`docs/handoff-2026-08-16-app-shell-goal-cache-and-e2e-findings.md`, then
`docs/implementation-backlog.md`.

Take Q-263 — audit the remaining cache groups the way Q-262 audited one. The method is in
`docs/reviews/2026-08-16-goal-invalidation-audit.md`: for each key in a group, does any call site
pass `freshWithinTtl`, and is any read path seed-only? Those are the only two ways an invalidation
changes a settled value, because `cachedFetchCore` always revalidates otherwise. Unlike
`invalidateGoalRecommendations()`, these groups ARE expected to contain load-bearing keys —
`lib/cache-groups.ts` flags `workout-data:all` and `workout-card:<id>` explicitly. The output is a
per-group note saying which keys carry the protection, not a deletion.

Watch the static blind spot: a key built by a helper (e.g. `energyKeyFor(date)`) is invisible to a
literal grep. `scripts/check-cache-ttl-divergence.js` prints how many such sites it skipped —
reconcile against that number rather than trusting a clean sweep.

Constraints that will otherwise be re-discovered:
- No device in session. Anything touching offline-first, native plugins, safe-area, gestures or
  notifications needs an on-device smoke run OR a ⚠️ Known-Issues row in projectOverview.md.
- Mutate every new test before believing it. This lane shipped three attempts at one guard, two of
  which passed with the code they guarded deleted.
- `get_check_runs` returning total_count 0 usually means a stale base — `git fetch origin main`,
  merge, push, and checks start. Check drift before assuming.
- Bash curl to api.github.com is NOT authenticated here. Use the GitHub MCP tools for all CI/PR state.
- Never `pkill -f "next dev"` — it matches your own shell. Kill by PID.
- Check `list_pull_requests` before starting an item, not just the backlog: two large pieces of work
  were built and thrown away this session because another lane shipped them first.
- `pnpm check:rules` is the custom-rules gate; quote its "Ran N of N" count rather than the word pass.

Two items need the owner and should NOT be self-assigned: Q-261 (design call on `<Label>` for button
groups) and a review of the CLAUDE.md cache-invalidation rule added on 2026-08-16.
```
