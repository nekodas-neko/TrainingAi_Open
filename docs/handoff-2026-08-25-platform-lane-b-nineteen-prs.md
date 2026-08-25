# Handoff — 2026-08-25 · Lane B implementation run

_Domain: `platform` (also touches `app-shell`, `nutrition`, `workouts`, `devices`, `readiness`) ·
Branch: `docs/handoff-lane-b-2026-08-25` · PR: see below · **Predecessor:**
[`docs/handoff-2026-08-24-platform-lane-b-nine-prs.md`](handoff-2026-08-24-platform-lane-b-nine-prs.md)_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/platform/README.md`, then `docs/agents/state/implementation-lane-b.md` — the baton,
> rewritten in full at the end of this run and the shortest path into the queue's real state. This
> file covers what *this* session did and left behind.

## Goal

Work the Lane B queue top-down, re-verifying each entry's premise against current `main` before
writing code — the instruction that opened the session, on the grounds that four of the previous
seven items taken had turned out already shipped, not worth doing, or wrong about their own cause.

## Current status

- **19 PRs merged, all CI-green.** `main` at `1682ede2`. Working tree clean, nothing open.
- **Build/test:** every PR ran `tsc --noEmit`, eslint, `pnpm check:rules` (**Ran 56 of 56**), the
  unit suite where touched, and E2E in CI. Local `pnpm dev` exercised for every UI change.
- **Device-verified: NO — nothing in this run.** Every shipped item carries `Gate: device`. The
  itemised list is in the baton under **Owed**.
- One row was **never rendered at all**: Q-281's amended "Final readiness" line needs a readiness
  score with an `ouraScore` present, and the local seed has no such row.

## What shipped

| PR | Entry | What |
|---|---|---|
| #446 | Q-406 | The food diary row is the shared `FoodRow`; its quick-edit sheet gained the delete the shared row could not carry |
| #447 | LB-10 | `use-sheet-back-dismiss` survives StrictMode's double invoke — `history.back()` resolves its delta when *called*, so push→back→push landed a `popstate` that closed the sheet on the frame it opened |
| #449 | Q-555 | Closed **unfixed**: the silent offline tab tap does not reproduce |
| #451 | Q-499 | Three more vanishing cards given error states (Oura section, AI Periodization, exercise HR trend) |
| #452 | LB-11 | `next-item.js` stops ranking shipped work as ready — a **KEEP** bucket |
| #454 | Q-477 | **Complete.** The client-timezone ratchet baseline is empty (78 bare calls → 0 across 539 files) |
| #456 | OR-1 | E2E restored to green on `main` |
| #457 | Q-467 | The Coach's undo has a button |
| #459 | BF-23 | Struck as a duplicate of OR-1, and my own overclaim corrected |
| #460 | Q-315 | The vacuum button can reach `error_events` (4 live rows in 49 MB) |
| #462 | PS-6 | The queue tooling learns the `OR-` prefix, in one shared place |
| #463 | Q-538 | The raw-store console says what its numbers mean (visible half) |
| #464 | Q-305 | Each muscle measured against its own goal-scaled landmarks, not a flat 10–20 |
| #465 | Q-281 | The readiness band's word ships with its colour; three entries laned to A |
| #466 | LB-12 | The queue says which rows it has not classified |
| #467 | Q-282 | The a11y rules that already ran can now fail |
| #468 | Q-154 | Re-measured: five needs listed, six exist |
| #469 | Q-138 | A ratchet row was keeping an already-fixed file exempt |
| #470 | — | The baton, rewritten |

Twenty-four journal entries dated 2026-08-25 in `docs/overview/entries/` carry the detail.

## The finding that matters most

**An entry's own premise is wrong often enough that checking it is the highest-value act in the
role.** Five entries were wrong about themselves this run:

- **Q-282** — *"no automated accessibility check exists anywhere in CI"*. One does: `jsx-a11y` via
  `next/core-web-vitals`, running all along. It just reported at **warning**, so nothing could fail.
- **Q-305** — *"computed and never shown"*. It **was** shown — against a hardcoded generic 10–20
  band, beside the real per-muscle table. Its own first pass then read the *unscaled* row and called
  lats "below MEV"; against the table the app uses, lats are in range and three muscles are over MRV.
- **Q-315** — *"what is left is a press"*. Nothing in the app could make that press.
- **Q-138** — two of its six rows were already done, with line numbers pointing at nothing.
- **Q-555** — the silent no-op does not reproduce; `app/error.tsx` answers, and the entry lists that
  page as missing.

Two of my own filings were also wrong and were corrected in place: **LB-10** said five sheets were
unopenable (one was), and my "every fresh browser profile is exposed" claim in #456 did not survive
BF-23's timing evidence.

**A grep count is not a violator list.** Q-491 claimed nine `aria-expanded` violators and had two;
Q-281's zero-`.label` grep would have flagged `contributor-chart`, which renders a legend and is
correct. Reading nine files removed eight false positives.

## Deliberately NOT done

- **LB-12's lane sweep** — 77 of 193 entries state no lane. Lane resolution is the **Orchestrator's**;
  an implementer bulk-editing 77 entries would be doing another agent's job across the file both
  lanes read. Filed with the measurement instead.
- **Q-305's push:pull half** — needs a muscle → movement-pattern taxonomy. There is none in the repo,
  and that is domain math belonging in `packages/shared` beside `normalizeMuscle` — Lane A's.
- **Q-282's real half** — touch-target size and contrast need a rendered page. Its stated dependency
  on the Q-250 emulator has **expired** (the Playwright harness is a real running app now, and
  `@axe-core/playwright` would measure both on the same DOM), but adopting that is a new dependency
  and a new failing-check surface — a decision for the owner or Orchestrator, not an implementer.
- **Q-538's bound** — `pruneRaw` deletes only rows marked `rolled_up`, and the only writer's only
  caller would be the WebView rollup consumer, which is not built. Lane A's, and no queue entry to
  point a `Needs:` at.
- **Q-138's four remaining extractions** — the entry says take them opportunistically when already in
  the file. Respected.
- **Q-354** — ends *"do not pursue without a reason"*. Its named trigger has not fired.
- **The `oura-ble/samples/vacuum` route**, now callerless — deleting it is `app/api/**`, Lane A's.

## Key decisions (with rationale)

- **The store stopped guessing the date rather than being handed a timezone (Q-477).** Both shapes the
  entry proposed give a Zustand store a zone it cannot legitimately have. `storedDate` exists only to
  be compared, so it is now written only by a caller that knows the zone, and `onRehydrateStorage`
  passes `null` and skips the date branch — guessing there **clears the day's completed-set ticks**.
- **The rollover check lives in the root layout, not the workout screen.** The check it replaced ran
  at rehydrate, i.e. on every app open; behind a mounted `workout-screen.tsx` it would leave someone
  who opens on Session Select after midnight looking at yesterday's ticks.
- **Undo gets no confirmation dialog (Q-467).** Undo *is* the safety net; friction in front of it is
  the wrong side of the trade. The route's 409 window is the real guard, rendered as a **state** on
  the row rather than an error.
- **The client clears the superset after an undo.** The route's own `invalidateProgramStructure()`
  runs on the **server**, where `lib/cache-groups` reaches localStorage and on-device SQLite — i.e.
  nothing. Taking that line at face value would have restored the programme in Postgres while every
  screen painted the changed one for a full TTL.
- **One shared `scripts/lib/entry-id.js` rather than four corrected regexes (PS-6).** Four copies is
  what let `OR-` drift; `lib/lane.js` carries the same lesson in its own comment.
- **The stale-baseline check is narrower than its sibling (Q-138).** The timezone check fails whenever
  a listed file merely improves; here that would fail CI on a refactor trimming thirteen lines off a
  1,833-line hotspot. Only the documented rule is enforced.

## Gotchas / what did NOT work

- **I built a fix on the wrong theory before measuring (OR-1).** Seeing `<button>` inside
  `<div role="button">`, I restructured a tile into a `role="group"` of two sibling buttons, reasoning
  that ARIA makes a button's subtree presentational. It type-checked and **still reported 0** — the
  cause was three levels up, `aria-hidden` on `<main>` from an open modal. Reverted in full.
- **Home's Morning Check-in is a modal.** Radix `aria-hidden`s `<main>` while it is open, so every
  `getByRole` on Home returns 0 and the failure reads as *"the affordance does not exist"*. Use
  `suppressMorningCheckin()` from `e2e/fixtures.ts`.
- **`open('f','w').write(open('f').read()…)` truncates before it reads** — wiped `package.json` to 0
  bytes; every tool then failed with `ERR_INVALID_PACKAGE_CONFIG`, which looks nothing like the cause.
- **The local seed drifts as you probe it.** `first-run-empty-states` and `goal-invalidation` went red
  locally from this session's own inserts and passed in CI. Check before believing a local red.
- **A scratch route needs `rm -rf .next`** — *"Invariant: missing bootstrap script"* is a stale `.next`.
- **`docs/lane-b-baton` was already taken** by a merged branch. `git ls-remote` before every push.
- **E2E is not a required check.** It sat red on `main` long enough for two agents to file it
  independently (OR-1 and BF-23, hours apart).

## Files to look at

- `docs/agents/state/implementation-lane-b.md` — the baton. Start here.
- `scripts/next-item.js`, `scripts/lib/{keep,entry-id,lane}.js` — the queue tooling, three fixes this run.
- `lib/hooks/use-sheet-back-dismiss.ts` — the StrictMode fix and why it needs an absorb listener.
- `components/shell/workout-day-rollover.tsx` — the day rollover, and why it is in the root layout.
- `e2e/fixtures.ts` — `suppressMorningCheckin`, and the comment explaining the race.

## Open questions / blockers

- **LB-12's sweep** — Orchestrator. 77 unlaned entries; 51 of Lane B's 56 READY rows.
- **Q-154** — owner. Six primitive props including a decorative halo, or three callers accept small
  visual changes. The second is better and changes how a user-facing chart looks.
- **Q-315's press** — owner, from a **desktop**, `/admin/oura-ble` → Table → `error_events`.
- **A device pass** — everything this run shipped.
- **A queue field that does not exist:** Q-354 is *understood and deliberately declined pending a
  named trigger*. That is neither `Gate: owner` nor `Gate: device`, so it reads as startable forever.

## Pickup prompt

```
You are the Implementation Agent for Lane B on nekodas-neko/TrainingAi_Open.

First, rename this session so its title is exactly "🚧 Implementation Agent (B) 🟢" — call
get_session with session_id omitted to get your own id, then set_session_title.

Read in this order before doing anything:
  1. projectOverview.md — current status and the live Known Issues tables
  2. docs/agents/state/implementation-lane-b.md — your baton, rewritten 2026-08-25
  3. docs/handoff-2026-08-25-platform-lane-b-nineteen-prs.md — the run that wrote that baton
  4. docs/domains/platform/README.md and docs/domains/app-shell/README.md

Then run `node scripts/next-item.js --lane B`.

DO NOT hunt the queue top-down — the 2026-08-25 run traversed the entire Lane B surface and
every candidate is accounted for in the baton's "Next" section. 51 of ~56 READY rows print
⟨lane unstated⟩ and the path rule puts almost all of them in Lane A. The startable Lane B work
sits 35–40 rows down, and each remaining candidate is gated, declined, parked, needs hardware
in hand, or is feature work with no plan.

So your first action is one of these two, and say which you picked and why:
  (a) If you have the S25 to hand: take the device-verification backlog. Everything the last run
      shipped is APK-unverified and itemised under "Owed" in the baton — Q-406's diary row and
      delete, Q-467's Coach undo, Q-499's three error states, Q-538's Read stats, Q-305's band
      words at S25 width, Q-477's rollover across local midnight. Q-315's vacuum press needs a
      DESKTOP, not the phone.
  (b) Otherwise: write a plan. Q-93-followup, Q-112 and Q-168 are real Lane B features with no
      implementation plan, and the backlog protocol wants a docs-only planning PR first.

RE-VERIFY every entry's premise against current main before writing code. On the last run five
entries were wrong about themselves (Q-282, Q-305, Q-315, Q-138, Q-555) and two of that run's
own filings needed correcting. A grep count is not a violator list — read the files.

Constraints that will otherwise cost you an hour:
  - `git fetch origin main` RE-SHALLOWS this clone; run `test -f .git/shallow && git fetch
    --unshallow origin` before every merge.
  - `git ls-remote origin 'refs/heads/<name>*'` before pushing — names are taken.
  - A conflict in docs/implementation-backlog.md is almost always TWO DELETIONS; keep neither side.
  - Rebuild packages/shared/src/changelog.ts from `git show origin/main:...` and prepend; never
    splice a conflict hunk.
  - projectOverview.md sits ON its shrink-only ratchet; re-measure with
    `node scripts/check-doc-index-size.js` and compact older shipped-notes, never raise the baseline.
  - Quote `pnpm check:rules`'s "Ran N of N" count, never the word "pass".
  - `get_check_runs` lags 30+ minutes; attempting the merge is the reliable green check. E2E is NOT
    a required check, so it can sit red on main — check it anyway before merging a UI change.
  - Home's Morning Check-in is a MODAL: Radix aria-hiddens <main>, so every getByRole on Home
    returns 0 and reads as "the affordance does not exist". Use suppressMorningCheckin() in e2e.

Merge your own CI-green PRs without asking. Confirm first only for data-dropping migrations,
auth/session/security, or secret handling.
```
