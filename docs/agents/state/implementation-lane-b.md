# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly, emoji included. That
> title is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread.

**Updated:** 2026-08-25 · **By:** the twelfth Lane B run · **Next ID:** `LB-15`

## Now
This run landed **#478** (Q-93-followup), **#479** (the Q-112 re-plan), **#483** (BF-27), **#491**
(BF-24), **#497** (BF-26), the baton PRs, and **BF-29** (My Meals → artboard 3). Each has a journal
entry in `docs/overview/entries/` dated 2026-08-25. **Every one owes only a device press.**

**CI E2E here takes about ELEVEN minutes, not the three `CLAUDE.md` quotes** — measured twice, and a
docs-only PR's E2E ran just as long, so it is the job's cost, not your change; never read it as a
hang. Corollary from #483: two local full-suite runs failed a *different* 1 and 3 specs that CI then
passed on a fresh database, so **distrust a local red that will not reproduce alone or in a subset.**

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
  `/health/day` shipped **seventeen days earlier** and is that screen. Two more claims were stale:
  the second renderer it names is deleted, and its `ev.date` is stamped centrally (route line 302).
- **Q-112** — same shape, larger. Task 27 wanted a new merged day screen because no per-day
  read-through existed; `/health/day` shipped **two days** later, so building it as written would
  have made a third day surface and re-implemented seven working sections.
- **BF-27** — sound, but its prescribed 40 call-site wirings were worse than one component.
- **BF-24** — accurate, and worth carrying: Q-395b and artboard 1 are *both* "grouped". The drawing
  groups the food ROWS within a meal; Q-395b grouped the MEALS within one box — which is why a
  coverage checklist passed while the owner said it did not look like the mockup.

## Next
`node scripts/next-item.js --lane B` first. Known-good candidates, in the order I would take them:
- **Q-395c** — nutrition phase 4; owns BF-24's ③ tiles. Check nobody else is on it.
- **BF-30 · BF-31** — the remaining artboard-parity entries. **Read BF-28 first**: an artboard is one
  screenful, and a section absent from it is not thereby deleted. BF-26 and BF-29 are done, and
  BF-29 left BF-30 a note: the row expands in place today, so **BF-30's "is this a screen?" decision
  now also owns the chevron glyph and un-duplicating label/edit/delete.**
- **BF-24 is PART done — do not re-take it whole.** #491 shipped ①④⑤; ②③⑥⑦ are kept on the entry
  with reasons (② also renders on `/health`, ③ is **Q-395c's**, ⑥ is Q-406's, ⑦ is decided).
- **Q-112a** — a real one-PR entry now, with a plan behind it
  ([`the day-review plan`](../../superpowers/plans/2026-08-25-unified-day-review.md)); Q-112c is Lane A and gates Q-112d.
- **Q-168, Q-154, Q-254, Q-111** — still gated, parked, or owner-decision. Unchanged.

## Do not re-litigate
- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**` are Lane A** whatever the edit
  looks like. The rule is the **path**, not the nature of the edit.
- **Radix `Collapsible`/`CollapsibleTrigger` supplies `aria-expanded`** — never a Q-491 violator.
- **`weekly-stats-hub`'s `todayKey` needs `.replace(/-/g,"/")`** — `/api/weekly-stats` emits `yyyy/MM/dd`.
- **Back-dismissal is the primitive's job now** —
  [`components/ui/back-dismiss.tsx`](../../../components/ui/back-dismiss.tsx), rendered by
  `SheetContent`/`DialogContent`. **Never call `useSheetBackDismiss` at a call site again** (two
  presses), and it must stay a *child* of `Content`: `SheetContent`'s body runs whenever a caller
  renders it, and every tab screen renders its sheets unconditionally with a null prop.

## Owed (device / physical)
**Nothing this run is device-verified**, and each entry keeps a `Gate: device` residue naming the
presses:
- **BF-27** — a plain sheet, a confirm dialog (must **cancel**, not confirm), and a nest
  (Log Food → History: one press must leave Log Food open).
- **Q-93-followup** — tap a workout and a walk row in Home's timeline; check the row does not fight
  `PullToSync`'s vertical gesture, and that `/health/day`'s back returns to Home.
- **BF-29** — the swipe is a **new gesture on the canonical runtime**: scroll the meal library and
  confirm no tray opens; drag one open and shut; open a second row and watch the first close.
- Carried from before: Q-406, Q-467, Q-499, Q-538 (Read stats), Q-305 at S25 width, Q-477 across
  local midnight, BF-10, LB-5, Q-328/Q-321/Q-486, Q-389 print/scan/share, a TalkBack pass,
  Q-450/Q-418 (needs a Polar H10). **Q-315 needs a DESKTOP, not the phone.**

## Filed this run, not worked
- **LB-14** — a client hanging up mid-post makes `readJsonLimited` reject uncaught, and
  `onRequestError` files the disconnect as a server fault in `error_events` *and* Sentry. Nine rows
  in 30 days, two BLE ingest routes. **Lane A's**, low priority, read from source not reproduced.
- **Q-112a–e** — the re-planned day review, five entries with lanes and `Needs:` fields.

## Claimed paths
None held.

## Gotchas worth carrying
- **`get_check_runs` AND `get_workflow_job` both lag 30+ minutes.** Build read `in_progress` long
  after a 3-minute job had finished and `get_job_logs` 404s throughout, which looks like
  confirmation. `failed_only: true` on the *run* was the freshest signal.
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
- **Rebuild `package.json`/`changelog.ts` from `git show origin/main:...`** and prepend; never splice
  a conflict hunk. Expect to re-bump: another agent took 1.372.0 while #483 was in review.
- **`projectOverview.md` sits ON its ratchet almost every PR**, and **so does this baton**. Compact
  an older shipped-note, never raise the baseline; the checker counts `wc -l + 1`. The backlog
  baseline is different — a planning PR may raise it, with a note in
  `doc-size-baseline-history.md`, but check whether `main` already left headroom (it had).
- **The local seed drifts as you probe it**, and a full local E2E run under load is not trustworthy:
  66/67 then 64/67 with different failures on identical code. `meal-label`'s first test exceeds its
  180 s timeout here **on `main` too** — six canvases and four zxing decodes under `pnpm dev`.
