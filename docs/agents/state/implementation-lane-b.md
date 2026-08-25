# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly, emoji included. That
> title is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread.

**Updated:** 2026-08-25 · **By:** the twelfth Lane B run · **Next ID:** `LB-15`

## Now
**One PR open: [#483](https://github.com/nekodas-neko/TrainingAi_Open/pull/483) (BF-27), and it is
yours to finish.** All five required checks went green on its previous head; the docs commit on top
restarted CI. **Do not merge it on the merge button alone** — E2E is not a required check, this
change touches every sheet and dialog in the app, and two local full-suite runs failed a *different*
1 and 3 specs (`meal-label`, `food-logging-complete`, `tabs-instant-paint (More)`). None reproduces
alone or in a subset, and the `meal-label` one has a mechanism that is the spec's own (it reads
canvas pixels gated only on `inkFraction > 0.01`, i.e. *any* ink, so a canvas caught mid-draw decodes
to nothing). Read the E2E job, then merge or fix. The reasoning is in the PR body and in that
branch's journal entry, `docs/overview/entries/2026-08-25-back-dismiss-sweep.md` — **both land only
when #483 merges**, which is why neither is linked here.

**Merged this run:** #478 (Q-93-followup), #479 (the Q-112 re-plan).

## The finding that should change how you start
**The previous baton said the startable Lane B surface was exhausted. It was not.** BF-27 sat at
**#3 of READY**, ungated, owner-requested, with its hook and its e2e spec already in the repo. The
2026-08-25 traversal that concluded otherwise was one day old.

**So: run `node scripts/next-item.js --lane B` and actually read the top five**, whatever any baton
says. A traversal is a snapshot; entries get unparked, dependencies land, and the owner files new
work daily.

**And re-verify every entry's premise before writing code — it is still the highest-value act in the
role.** Three for three this run:
- **Q-93-followup** — *"no historical per-session HR-chart/exercise-detail screen exists at all"*.
  `/health/day` shipped **seventeen days earlier** and is exactly that screen. Two more of its claims
  were stale: the second renderer it names is deleted, and the `ev.date` it needs is stamped
  centrally at `app/api/day-timeline/route.ts:302`, so no Lane A change was involved.
- **Q-112** — same shape, larger. Task 27 asked for a new merged day screen because no per-day
  read-through existed; `/health/day` shipped **two days** after it was written. Building it as
  written would have made a third day surface and re-implemented seven working sections.
- **BF-27** — sound, but its prescribed approach (40 call-site wirings) was worse than one component,
  and its *"the quantity sheet passed"* observation points at a file that has no hook at all.

## Next
`node scripts/next-item.js --lane B` first. Known-good candidates, in the order I would take them:
- **Q-395c** — top of READY, nutrition phase 4. PR #458 exists to unpark it; check whether another
  session is on it before starting.
- **BF-24** — the shipped nutrition day screen vs artboard 1. Lane B, owner-reported, has a drawing
  to build against.
- **Q-112a** — a real one-PR entry now, with a plan behind it
  ([`the day-review plan`](../../superpowers/plans/2026-08-25-unified-day-review.md)); Q-112c is Lane A and gates Q-112d.
- **Q-168, Q-154, Q-254, Q-111** — still gated, parked, or owner-decision. Unchanged.

## Do not re-litigate
- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**` are Lane A** whatever the edit
  looks like. The rule is the **path**, not the nature of the edit.
- **Scoring changes are nobody's to implement**: Tuning proposes → owner signs off → Lane A builds.
- **Radix `Collapsible`/`CollapsibleTrigger` supplies `aria-expanded`** — never a Q-491 violator.
- **`weekly-stats-hub`'s `todayKey` needs `.replace(/-/g,"/")`** — `/api/weekly-stats` emits `yyyy/MM/dd`.
- **Back-dismissal is the primitive's job now** (once #483 lands). `SheetContent`/`DialogContent`
  render `components/ui/back-dismiss.tsx`. **Never call
  `useSheetBackDismiss` at a call site again** — it would push twice and need two presses. And it
  must stay a *child* of `Content`: `SheetContent`'s body runs whenever a caller renders it, and
  every tab screen renders its sheets unconditionally with a null prop.

## Owed (device / physical)
**Nothing this run is device-verified**, and each entry keeps a `Gate: device` residue naming the
presses:
- **BF-27** — a plain sheet, a confirm dialog (must **cancel**, not confirm), and a nest
  (Log Food → History: one press must leave Log Food open).
- **Q-93-followup** — tap a workout and a walk row in Home's timeline; check the row does not fight
  `PullToSync`'s vertical gesture, and that `/health/day`'s back returns to Home.
- Carried from before: Q-406, Q-467, Q-499, Q-538 (Read stats), Q-305 at S25 width, Q-477 across
  local midnight, BF-10, LB-5, Q-328/Q-321/Q-486, Q-389 print/scan/share, a TalkBack pass,
  Q-450/Q-418 (needs a Polar H10). **Q-315 needs a DESKTOP, not the phone.**

## Filed this run, not worked
- **LB-14** — `readJsonLimited` rejects when a client hangs up mid-post, nothing catches it, and
  `onRequestError` files the client's disconnect as a server fault in **both** `error_events` and
  Sentry. Nine rows in 30 days across two BLE ingest routes. **Lane A's**, low priority. Read from
  source, not reproduced.
- **Q-112a–e** — the re-planned day review, five entries with lanes and `Needs:` fields.

## Claimed paths
None held.

## Gotchas worth carrying
- **`get_check_runs` AND `get_workflow_job` both lag badly — 30+ minutes measured today.** Build read
  `in_progress` long after a 3-minute job must have finished, and `get_job_logs` 404s throughout,
  which looks like confirmation and is not. `failed_only: true` on the *run* was the freshest signal.
- **`.click()` does nothing inside `[data-swipe-carousel]`** (Q-354) — use `page.touchscreen.tap()`.
  **And the tab shell mounts several panels at once, so DOM order is not screen order**: an unscoped
  `getByRole(...).first()` resolves into an off-screen panel, where a forced click switches tabs
  instead. Pick the element whose box is inside the viewport. It looked exactly like my own change
  breaking the app. **Run the probe against unmodified `main` before believing you broke something.**
- **`pkill -f "next dev"` exits 144 and kills the rest of a compound command** — put it last. The
  previous baton said this and I did it anyway.
- **Shallow clone: `git fetch --unshallow origin` before every merge**, or `git fetch origin main`
  re-shallows and the merge dies with "refusing to merge unrelated histories."
- **`git ls-remote origin 'refs/heads/<name>*'` before pushing** — five baton names are taken.
- **A backlog conflict is usually TWO DELETIONS** — read the headings, keep neither side.
- **Rebuild `package.json`/`changelog.ts` from `git show origin/main:...`** and prepend; never splice
  a conflict hunk. Expect to re-bump: another agent took 1.372.0 while #483 was in review.
- **`projectOverview.md` sits ON its ratchet almost every PR.** Compact an older shipped-note, never
  raise the baseline; the checker counts `wc -l + 1`. **The backlog baseline is different** — a
  planning PR adding real entries may raise it, with a note in `doc-size-baseline-history.md`, but
  check first whether `main` already left headroom (it had).
- **The local seed drifts as you probe it**, and a full local E2E run under load is not trustworthy:
  I got 66/67 then 64/67 with different failures on identical code.
