# Handoff — the 2026-08-14 UI/flow/IA review cluster (Q-232 … Q-244), delegated to a second lane

> **✅ CLOSED 2026-08-15. This lane is finished and its file ownership is released.** Every item is
> merged except Q-243. See
> [`docs/handoff-2026-08-15-app-shell-ia-cluster-complete.md`](handoff-2026-08-15-app-shell-ia-cluster-complete.md)
> for what shipped, the decisions made, and the three follow-ups (Q-255, Q-257, Q-232-followup).
> The file-ownership table below is **historical** — none of those paths are held any more.

**Written:** 2026-08-14 · **Domain:** `app-shell` (secondary: `nutrition`, `platform`, `devices`)
**Reason:** the backlog holds ~67 open entries and ~56 that need no owner input. One lane cannot
work that in any reasonable time, so the queue is being split in two.

This document is the **coordination contract** between the two lanes. Both should be able to re-read
it. It is not a session handoff — nothing here has been started.

---

## The split, and why it falls here

The constraint that decides the seam is **collision surface**, not item count. This repo has already
paid for parallel agents: six Q-number collisions in three days, two collided migration-number pairs
still in the tree, and `package.json` / `packages/shared/src/changelog.ts` conflicting on
essentially every parallel merge.

So the seam is drawn by **file ownership**, and the cluster is kept whole. Q-232's own entry says it
is the umbrella for Q-233, Q-234, Q-235 and Q-237 and that they *must not* be worked one at a time,
or the app ends up half-reorganised in two incompatible directions. Splitting a child away from its
umbrella would cause exactly that, so the whole 2026-08-14 review — **Q-232 through Q-244** — goes
to one lane.

### Lane B (the delegated lane) owns

| Path | Held for |
|---|---|
| `app/more/**`, `components/more/**` | Q-232, Q-233, Q-235, Q-239 |
| `components/profile/**` | Q-232, Q-233 |
| `app/admin/**` | Q-234 |
| `app/overview/**`, `components/overview-screen.tsx`, `app/sheet/**` | Q-236 |
| `app/nutrition/nutrition-content.tsx` | Q-237, Q-243 |
| `lib/health-card-order.ts` | Q-238 |
| `app/health/health-content.tsx` | Q-238, Q-242, Q-243 |
| `components/shell/tabs.ts`, `app/config/page.tsx`, `components/config-screen.tsx` | Q-235 |
| `scripts/check-*.js` (new checks only) | Q-244 |

### Lane A (continuing) owns

`lib/data/postgres/**` (including **all** migrations), `lib/local-store/**`, `lib/sqlite/**`,
`packages/shared/src/**`, `lib/cache-groups.ts`, and the workout / devices / readiness screens.
Working Q-187, then the platform and data-integrity run (Q-181, Q-155, Q-180, Q-184, Q-204, Q-107,
Q-137, Q-138, Q-85, Q-116, Q-114, Q-111, Q-105-followup).

**Lane A will not touch `app/health/health-content.tsx` or `app/nutrition/nutrition-content.tsx`
while this cluster is open.** Q-187's UI half is deliberately held back until Q-237 lands, so the
nutrition screen has one owner at a time.

### The numbers, claimed up front

This is the single rule that removes the collision class this repo keeps hitting. Do not "check and
take the next free" — the pointer is a floor, and a number can be claimed *and merged* inside one
session without ever appearing in an open PR.

- **Lane B claims Q-248 … Q-269** for any new findings. (`Next free Q number` on `main` reads 248 as
  of this writing; 245–247 are already taken.)
- **Lane A claims Q-270 upward.**
- **Lane B claims no migration numbers at all.** Nothing in Q-232…Q-244 needs a schema change; if
  one turns out to be necessary, stop and say so rather than taking a number. Lane A holds
  everything from `187_` up (head on `main` is `186_q228_deloaded_log_1rm_straggler.sql`).

### The conflicts that will still happen

`package.json` and `packages/shared/src/changelog.ts` conflict on every parallel merge and there is
no way around it. Resolve by **rebuilding from `origin/main`, never by splicing the conflict hunks**
— when two PRs bump on the same day the conflict falls *inside* an entry's `changes:` array and both
sides share the `version:`/`date:` header above the marker, so a naive splice silently drops the
other lane's version. Take `git show origin/main:packages/shared/src/changelog.ts`, prepend your
entry at the next free version, write the whole file.

---

## The work

Ten entries. Read each one in `docs/implementation-backlog.md` before starting it — the summaries
below are orientation, not the spec.

### Start here: four items that need no plan and land immediately

1. **Q-238 — Health card ordering and hiding is read-only.** `saveHealthCardOrder` and
   `saveHiddenHealthCards` in `lib/health-card-order.ts` have no callers outside their own test. The
   *readers* are live, which is what makes the feature look shipped. Decide whether to wire the
   writers up or delete them, and say which in the journal.
2. **Q-242 — `day-log:` is fetched with two different TTL expressions.** One site passes a literal
   `TTL_MEDIUM`, the other passes `DAY_LOG_TTL`. The values are equal today, so **nothing is broken**
   — this is the one-canonical-TTL rule, not a bug. Small.
3. **Q-236 — `/overview` is a 543-line screen with zero entry points.** Verify the orphan claim by
   grep before deleting anything.
4. **Q-244 — hex literals went 430 → 471 in five days** while `CLAUDE.md` recorded the trend as
   improving. Add a shrink-only baseline check in the Custom Rules job, the same shape as
   `scripts/check-component-size.js`.

### Then the umbrella, which gates the rest

5. **Q-232 — write the plan first.** `docs/superpowers/plans/2026-08-14-more-tab-information-architecture.md`,
   covering the whole target structure for Q-233, Q-234, Q-235 and Q-237 together. Do not execute
   Q-232 straight from the backlog entry; its own text forbids it.
6. **Q-233 — no Devices screen.** Ring, chest strap, scale and background-location cards are stacked
   inline between "Goals" and "Settings" in a profile scroll.
7. **Q-234 — the admin console mixes user administration with developer diagnostics.** Nine tabs plus
   three sub-consoles reachable only from inside Tools.
8. **Q-235 — the Program Builder sits in More under a sub-tab literally named "Workout"**, colliding
   with the Workout tab in the bottom nav.
9. **Q-237 — Nutrition's actions are placed by scroll depth.** Saved Meals and End of Day sit *below*
   every meal card.

### And one that is a decision, not code

10. **Q-239 — six screens are reachable from exactly one card each.** The deliverable is a written
    decision per screen (promote / leave / merge), not a refactor.

---

## What will otherwise be rediscovered the hard way

Everything below cost this project a session at least once.

- **`pnpm check:rules` is the custom-rules gate.** Not `pnpm ci:local`, not globbing
  `scripts/check-*.js` — those miss the inline grep rules and report clean. Quote the `Ran N of N`
  count it prints; do not hardcode N.
- **`pnpm build` is part of the local gate.** tsc + lint + rules + suite is not enough: a client
  component importing a module that reaches `node:path` type-checks and tests fine, then fails CI's
  Build job. That happened today (Q-230).
- **A guard or harness proves nothing until it is shown to DISCRIMINATE.** Run it against the
  *unfixed* code and watch it fail before you believe a pass. Today alone that caught a guard keyed
  on a string the fix itself introduced — so it recognised only code already carrying the fix — and
  a guard that sliced from the wrong occurrence and passed with the field deleted.
- **Re-verify every entry's premise against current `main` before implementing.** Today: Q-224 had
  five wrong premises, Q-228's symptom had self-cleared, Q-226 needed a second change the entry
  missed, Q-216 said 2 sites when 12 had it, Q-230 named 2 writers when there were 4. The entries
  are leads, not specs.
- **Hit the live route.** `pnpm dev`, then actually call the endpoint. A helper reading a field the
  route never exposed compiled, ran, and would have returned null forever; no test caught it.
- **Safe-area:** bottom-anchored controls use `pb-safe-action` (nav screens) or `pb-safe-action-lg`
  (full-screen/navless). Bare `pb-safe` gives near-zero clearance on the device. Bottom sheets bake
  their own inset — never add `pb-safe*` inside one.
- **Instant paint:** every screen seeds synchronously from cache in a `useEffect` (never a `useState`
  lazy initializer — that caused hydration mismatches) and revalidates behind it. A skeleton on a
  repeat visit is a bug.
- **Nested controls:** `<div role="button">` for a tappable card containing other controls, never a
  nested `<button>`; and never interactive content inside a real `<button>`.
- **Component files stay under 800 lines**, enforced by a shrink-only baseline. Several files in this
  cluster are already over it — extract rather than append, and drop a file from the baseline in the
  same PR if it goes under.
- **`get_check_runs` lags the job endpoint by a minute or so.** If a check looks stuck, confirm with
  `actions_get / get_workflow_job` before diagnosing. And `total_count: 0` several minutes after
  opening a PR means a stale base, not slow CI — merge `origin/main` and push.
- **Re-merge `origin/main` immediately before opening each PR**, not just when cutting the branch.
  With two lanes merging, a branch cut from a current `main` goes stale while you work.
- **Commit before every `git checkout`**, and never `git add -A` after a checkout that carried
  changes — that has put one item's work into another item's PR twice in one session.

## The bar

Local `pnpm dev` exercising every changed route and UI flow · `pnpm build` · `npx tsc --noEmit` ·
`pnpm lint` · `pnpm check:rules` (quote the count) · full suite · every new test mutation-verified.

Nothing in this cluster is device-verifiable from the sandbox. Safe-area, gestures and Samsung
WebView rendering render as 0 / fine in the web sandbox and only fail on the S25 — so any PR here
that moves a fixed header, a bottom-anchored control or a sheet needs an explicit
**⚠️ not device-verified** row in `projectOverview.md`.

Per-PR: journal entry as a **new file** in `docs/overview/entries/`, `projectOverview.md` updated,
the completed backlog entry **removed** (not marked done), and a version + changelog bump if the
change is user-visible — all in the same PR, committed before the merge fires.
