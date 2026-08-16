# Handoff — UI/flow/IA + caching review, and the agent-testing-capability cluster

**Date:** 2026-08-14 · **Domain:** `app-shell` (secondary: `platform`)
**Branches:** `claude/app-ui-flow-audit-140pzy` (merged, PR #1338) · `feat/agent-testing-capability` (this one)
**Nothing was implemented.** Two docs-only PRs. 19 backlog entries filed, Q-232…Q-244 and Q-249…Q-254.

> **⚑ State when this handoff was written — three findings had already shipped, within hours.**
> Parallel sessions took **Q-240 and Q-241** (goals: cache invalidation + single source of truth,
> v1.307.1, shipped together as their entries directed) and **Q-238** (Health card ordering —
> resolved by *deleting* the mechanism, not building the customiser, v1.307.2; git history showed the
> UI had existed for one day and been removed on purpose). **Q-242** is in flight as PR #1347.
> **Ten of the thirteen review findings are still open**, and the sections below describe all
> thirteen as they were found — read them as the reasoning, not as current queue state. Check the
> backlog before starting any of them.

## What the session was trying to achieve

The owner asked for a full app review — *"the ui and flow/location mainly … a lot of pages/settings
etc that are just placed randomly (i.e. admin tools, more screen, nutrition buttons)"* — plus
caching and cache busting, then the standing lenses, with every finding filed as a backlog task.
They asked for the review prompt to be written first and then worked through; both are committed.

A second question at the end — *"is there any other form of access I could give to the agents for
better testing?"* — turned into the second half of the session and its own six-entry cluster.

## What actually shipped

**PR #1338 (merged, `0d5cf1b`):**
[`docs/reviews/2026-08-14-app-ui-flow-ia-review-prompt.md`](reviews/2026-08-14-app-ui-flow-ia-review-prompt.md)
and [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](reviews/2026-08-14-app-ui-flow-ia-review.md),
13 backlog entries (Q-232…Q-244), three `projectOverview.md` Known-Issues rows, the pillar-index
link, and the journal entry.

**This PR:** review §7 (the testing-gap measurement), six backlog entries (Q-249…Q-254) placed above
the IA cluster, one more Known-Issues row, this handoff.

## The findings that matter

**Information architecture — the owner's premise held, and it is narrower than it sounds.** The
screens are mostly well built; the **container layer** is what is disorganised. More → Profile is one
845-line scroll holding thirteen kinds of thing (**Q-232**, the umbrella). The Program Builder lives
in More under a sub-tab *also* called "Workout" (**Q-235** — that ambiguity already shipped Q-223).
Admin mixes user administration with device diagnostics and buries both at the bottom of that scroll
(**Q-234**). Four device cards inline with no Devices screen (**Q-233**). Nutrition's actions placed
by scroll depth (**Q-237**).

**Two dead surfaces fell out of the reachability grep rather than being looked for.** `/overview` is
a 543-line screen with **zero** in-app entry points, duplicating Home (**Q-236**). Health's card
ordering has live readers in six places and **no caller for either writer** (**Q-238**) — same shape
as Q-180.

**Caching: the codified rules hold; two call sites do not.** Worth stating the healthy half, because
it is the more useful result — 33/33 custom rules pass, **zero** `invalidateCache()` call sites
outside `lib/cache-groups.ts`, all 73 keys reachable from a group, one fetch variant per key, every
`body-metadata` read guarded on both seed and hit path, and the service worker's two-generation
retention makes deploy busting sound. The two real findings are where no check reaches: a goal edit
that never busts `user-goals` (**Q-240**), and goals dual-written to `localStorage` and the server
with Health reading three of them from the device copy (**Q-241**).

**The testing gap is smaller than the number suggests.** 81 rows say "NOT verified on device"; only
~25 actually need the device. The largest bucket — ~25 rows — needs nothing but somebody running the
app, and **Playwright's browsers are already installed in every session** while Playwright is not a
project dependency. See review §7.

## Decisions made, and why — so they are not re-litigated

- **The IA cluster is not five independent PRs.** Q-232 is explicitly marked as needing a written
  plan covering Q-233/234/235/237 together. Worked one-at-a-time from their entries, they would
  leave the app half-reorganised in two incompatible directions. This is the single most important
  thing to preserve about that cluster.
- **Q-249 (E2E) is placed above the IA cluster on purpose.** It is one PR, it needs no new access,
  and Q-232's restructure is the largest UI refactor in the queue with currently no way to prove it
  did not break a screen. The rationale is written into the cluster's header note so it can be
  disagreed with rather than silently inherited.
- **The whole testing cluster goes before Q-49** (public-repo migration), at the owner's direction.
  The deadline is load-bearing, not a preference: Q-49's 2026-08-10 decisions commit to *"CI stays
  offline and holds no credential"*, and Q-252/Q-253 both want one. That is a straightforward
  conversation on a private repo and an awkward one after the cut.
- **Q-253 (device farm) is filed to be decided, possibly declined.** Most of the hardware bucket is
  BLE, which no farm can produce.
- **Nothing was implemented.** Per *Backlog-driven implementation*: plan now, build later. The one
  exception worth flagging is that **Q-249 was written as "build this, don't just plan it"** — it is
  small enough that a planning round would cost more than the work.

## Dead ends and gotchas

- **`node_modules` was only partially installed at session start** (68 packages), so `pnpm
  check:rules` failed with `Cannot find module 'js-yaml'` — which reads exactly like a broken gate
  rather than a broken environment. `pnpm install --frozen-lockfile` first; it then ran 33 of 33
  clean. Worth checking before believing any tooling failure in a fresh session.
- **The clone is shallow (50 commits)**, so `git log --since=…` returns essentially every file and
  cannot scope "what changed since the last review".
- **A substring grep of `lib/cache-groups.ts` under-reports invalidation coverage.**
  `friends-list`/`friends-feed` look uncovered until you notice `invalidateFriends()` invalidates the
  `friends-` *prefix*. Three of four "missing" keys were false alarms for this reason.
- **`WaterLogSheet` already invalidates internally.** The three divergent call-site callbacks are
  redundant, not broken — the finding inverted from "stale data" to "over-invalidation" (Q-243) only
  after reading the sheet. Read the component before writing up a call site.
- **The Q-number pointer cannot see unmerged PRs, and it bit again.** The file said "next free: 248";
  open PR **#1345** already held Q-248. `list_pull_requests` caught it. Always check both.
- **A parallel session claimed Q-245/246/247 mid-session**, and another is already implementing
  **Q-242** (PR #1347). Re-read the pointer immediately before claiming numbers.

## Deliberately not done

- No code changed in either PR.
- The `~25 stale rows` were **not** swept — that is Q-254, and it must run *after* Q-249 so rows are
  closed by a passing spec rather than by reading, which `CLAUDE.md` forbids ("never mark an issue
  fixed from intent").
- The per-row bucketing of the 81 device rows was done **from headings, not by reading each row**.
  It is directionally sound and not authoritative; Q-254 re-tags them properly. Do not quote the
  "81 → 30" projection as a commitment.

## Blocked on the owner

- **Q-251 (staging)** is the one item with a recurring cost — a second Railway service and its DB.
  Needs a cost decision before building.
- **Q-252 / Q-253** need a spend decision and, for Q-253, a device-farm account.
- Nothing else in the cluster needs anything from the owner. **Q-249 and Q-250 can both start today.**

## Pickup prompt

> You are picking up the TrainingAI queue after the 2026-08-14 UI/flow/IA + caching review. Check out
> `main` (`git fetch origin main && git remote prune origin && git checkout -B <your-branch> origin/main`).
>
> Read in this order: `projectOverview.md` (orientation + the two newest Known-Issues rows, one on
> the IA findings and one on the testing gate) → `docs/domains/app-shell/README.md` →
> `docs/handoff-2026-08-14-app-shell-ui-flow-ia-review-and-testing-capability.md` (this doc) →
> `docs/reviews/2026-08-14-app-ui-flow-ia-review.md`, whose §7 is the measurement behind the work
> below.
>
> **Your first action: implement Q-249** — the E2E harness. Its backlog entry says "build this,
> don't just plan it" and scopes the first PR deliberately small (sign in as the seeded
> `test@local.dev`, walk the five tabs asserting real content on a *repeat* visit, log a set/food/water
> and assert each appears without a reload, and add the Q-240 regression: change a goal, open Health,
> assert the number changed). Playwright's browsers are already installed at `/opt/pw-browsers` with
> `PLAYWRIGHT_BROWSERS_PATH` pre-set — add `@playwright/test` as a dependency, never run
> `playwright install`.
>
> Constraints that will otherwise be re-discovered: run `pnpm install --frozen-lockfile` before
> trusting any tooling failure (a fresh session may have a partial `node_modules`, and
> `pnpm check:rules` fails with `Cannot find module 'js-yaml'` when it does). `getLocalStore` returns
> null outside the APK, so the harness proves the **web fallback branch only** — say so in its README
> or it will be over-trusted. Do not hardcode one side of a rolling-window date. Claim Q numbers
> against **both** `docs/implementation-backlog.md` and `list_pull_requests` — the pointer cannot see
> unmerged PRs and that has now caused two collisions. Everything reaches `main` through a PR with
> all five checks green.
>
> Do **not** start the IA cluster (Q-232…Q-237) as individual items — Q-232 is the umbrella and needs
> a written plan covering the whole set first. Do not let Q-49 (the public-repo migration) land before
> the Q-249…Q-254 cluster; the owner directed that ordering, and Q-49's "CI holds no credential"
> decision conflicts with Q-252/Q-253.
