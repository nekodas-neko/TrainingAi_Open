# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-08-25 · **By:** the twelfth Lane B run · **Next ID:** `LB-15`

## Now
Landed: **#478** (Q-93-followup), **#479** (Q-112 re-plan), **#483** (BF-27), **#491** (BF-24),
**#497** (BF-26), **#512** (BF-29), **#515** (BF-25), **#523** (BF-30), **#524** (BF-32), the baton
PRs; **#526** (BF-31) is open. **ARTBOARD PARITY IS DONE** — BF-24/26/29/30/31/32 shipped, BF-28 is
the map not work. Each has a journal entry; **every one owes a device press and nothing else.**
Expect to re-merge `main` two or three times per PR — it landed one during *every* CI cycle tonight,
and two merge attempts were refused for it.

**CI E2E here takes about ELEVEN minutes, not the three `CLAUDE.md` quotes** — measured twice, and a
docs-only PR's E2E ran just as long, so it is the job's cost, not your change; never read it as a
hang. Corollary from #483: two local full-suite runs failed a *different* 1 and 3 specs that CI then
passed on a fresh database, so **distrust a local red that will not reproduce alone or in a subset.**

## The finding that should change how you start
**Run `node scripts/next-item.js --lane B` and read the top five, whatever any baton says** — a
traversal is a snapshot, and the one that declared Lane B exhausted was a day old while BF-27 sat
ungated at #3.

**Re-verify every entry's premise before writing code — still the highest-value act in the role.**
Nine for nine this run, and it is not only staleness: **two entries prescribed a fix that was
wrong.** Q-93-followup and Q-112 each wanted a screen `/health/day` had already shipped; BF-31 named
files from a different flow; BF-32's scope was wider than its own artboards. BF-27's 40 call-site
wirings lost to one component, and **BF-25's "one line" would have shipped the bug it closes** —
`forcedTheme` alone leaves `resolvedTheme` on the OS, so DetailHero painted a white scrim on a dark
page. Measured, not reasoned. BF-24's is worth carrying whole: Q-395b and artboard 1 are *both*
"grouped", the drawing grouping food ROWS within a meal where Q-395b grouped MEALS in one box —
which is why a coverage checklist passed while the owner said it looked wrong.

## Next
`node scripts/next-item.js --lane B` first. Known-good candidates, in the order I would take them:
- **Q-395c** — nutrition phase 4, and the next real one. **Re-read it first: it now inherits SIX
  shipped surfaces** (the day screen, My Meals, the meal detail sheet, the builder, the shared row
  and its tile) rather than the ones its text describes. It owns BF-24's ③ tiles and the one-name
  rename sweep. Check nobody else is on it.
- **The artboards keep narrowing entries' prose.** BF-32 listed the ingredient lists in scope; the
  drawings put the tile on meal-level rows only. **Extract the values from the HTML** rather than
  reading the picture — nine identical 40 px tiles is what says it is one shared thing.
- **Q-112a** — one PR now, with [`a plan`](../../superpowers/plans/2026-08-25-unified-day-review.md) behind it; Q-112c is Lane A.

## Do not re-litigate
- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**` are Lane A** whatever the edit
  looks like. The rule is the **path**, not the nature of the edit.
- **Back-dismissal is the primitive's job now** —
  [`components/ui/back-dismiss.tsx`](../../../components/ui/back-dismiss.tsx), rendered by
  `SheetContent`/`DialogContent`. **Never call `useSheetBackDismiss` at a call site again** (two
  presses), and it must stay a *child* of `Content`: `SheetContent`'s body runs whenever a caller
  renders it, and every tab screen renders its sheets unconditionally with a null prop.

## Owed (device / physical)
**Nothing this run is device-verified**; each entry keeps a `Gate: device` residue naming the presses:
- **BF-27** — a plain sheet, a confirm dialog (must **cancel**, not confirm), and a nest
  (Log Food → History: one press must leave Log Food open).
- **Q-93-followup** — tap a workout and a walk row in Home's timeline; check the row does not fight
  `PullToSync`'s vertical gesture, and that `/health/day`'s back returns to Home.
- **BF-29 · BF-30 · BF-31 · BF-32** — the swipe is a **new gesture on the canonical runtime**:
  scroll the library, confirm no tray opens, drag one open and shut. Meal detail is a **nested**
  sheet, so back unwinds three layers. The builder's pinned footer must clear the gesture bar, and
  its inline name input must survive the keyboard. And a data-URI `<img>` now sits in every diary
  row — the shape Samsung's compositor has mishandled before.
- **BF-25** — put the S25 in **light** mode; the app must stay dark, including the icon routes (no
  CSS) and any canvas paint.
- Carried from before: Q-406, Q-467, Q-499, Q-538 (Read stats), Q-305 at S25 width, Q-477 across
  local midnight, BF-10, LB-5, Q-328/Q-321/Q-486, Q-389 print/scan/share, a TalkBack pass,
  Q-450/Q-418 (needs a Polar H10). **Q-315 needs a DESKTOP, not the phone.**

## Filed this run, not worked
- **LB-14** — a client hanging up mid-post makes `readJsonLimited` reject uncaught, so
  `onRequestError` files the disconnect as a server fault in `error_events` *and* Sentry. Nine rows,
  30 days, two BLE ingest routes. **Lane A's**, low priority, read from source not reproduced.
- **Q-112a–e** — the re-planned day review, five entries with lanes and `Needs:` fields.

## Claimed paths
None held.

## Gotchas worth carrying
- **`get_check_runs` AND `get_workflow_job` both lag 30+ minutes.** Build read `in_progress` long
  after a 3-minute job had finished and `get_job_logs` 404s throughout, which looks like
  confirmation. `failed_only: true` on the *run* was freshest. Auto-merge reports queued checks as
  *"unstable status (required checks are failing)"* — that is pending, not failing.
- **`.click()` does nothing inside `[data-swipe-carousel]`** (Q-354) — use `page.touchscreen.tap()`.
  The tab shell mounts several panels, so an unscoped `getByRole(...).first()` lands off-screen.
  **Probe unmodified `main` before believing you broke something.**
- **Shallow clone: `git fetch --unshallow origin` before every merge** — `git fetch origin main` re-shallows it, and the merge dies with "unrelated histories". Bit again tonight.
- **`pkill -f "next dev"` exits 144 and kills the rest of a compound command** — put it last.
- **The backlog two-deletions trap fired again, and git AUTO-MERGED it** — no conflict markers, both
  entries silently back. Two branches each removing a *different* shipped entry is the shape. **After
  every merge, `grep -c '^### .*<your-ids>' docs/implementation-backlog.md`**; rebuild from
  `origin/main` and re-apply your one deletion rather than splicing.
- **`toBeVisible()` is true 500 ms before a sheet ARRIVES** (`SheetContent` slides in over
  `duration-500`), so a `boundingBox()` right after reads a position it is still travelling through
  — y=1127 on a 915 px viewport — and the coordinate tap hits nothing. Follow with `toBeInViewport()`.
- **Rebuild `package.json`/`changelog.ts` from `git show origin/main:...`** and prepend; never splice
  a hunk. **Expect to re-bump — four times tonight — and the version is written in FOUR places**: both
  those files, `projectOverview.md`'s status line, and your Known-Issues heading. Re-pick from
  whatever `main` is at, then sync all four.
- **`projectOverview.md` sits ON its ratchet almost every PR**, and **so does this baton**. Compact
  an older shipped-note, never raise the baseline; the checker counts `wc -l + 1`. **Reword and you
  will land line-neutral** — print old vs new newline counts before writing. Merging a fresh `main`
  often supplies the headroom for free.
- **A local full E2E run under load is not trustworthy** — 66/67 then 64/67 on identical code; and
  `meal-label`'s first test exceeds its 180 s timeout here **on `main` too**, passing in CI.
