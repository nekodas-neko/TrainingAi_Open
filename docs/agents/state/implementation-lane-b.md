# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly, emoji included. That
> title is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread.

**Updated:** 2026-08-25 · **By:** the eleventh Lane B run · **Next ID:** `LB-13`

## Now
**Nothing open — every branch merged.** This run landed **18 PRs**: #446 (Q-406 diary row), #447
(LB-10), #449 (Q-555 closed unfixed), #451 (Q-499), #452 (LB-11), #454 (Q-477 complete), #456 (OR-1),
#457 (Q-467), #459 (BF-23), #460 (Q-315), #462 (PS-6), #463 (Q-538 half), #464 (Q-305 half), #465
(Q-281 subset), #466 (LB-12), #467 (Q-282 corrected), #468 (Q-154 measured), #469 (Q-138 ratchet).
Each has a journal entry in `docs/overview/entries/` dated 2026-08-25 — read those, not this file.

## Next
**⚠️ Do NOT start by hunting the queue top-down — it will waste an hour.** `node scripts/next-item.js
--lane B` now marks `⟨lane unstated⟩` rows; **52 of ~56 READY are unstated**, and applying the path
rule to them puts almost all in Lane A. **The startable Lane B work sits ~35–40 rows down.**

**The whole surface was traversed on 2026-08-25 and every candidate is accounted for:**
- **Q-395b, Q-395a, Q-406, BF-10, Q-486, Q-499, LB-5, Q-316/317/318, Q-544, Q-461, Q-319** — shipped,
  `Keep:` is a device check only. They print under **KEEP** now, not READY.
- **Q-354** — *"do not pursue without a reason"*, deliberately declined. Its named trigger (a scanner
  driving mouse input) has NOT fired: Q-282's jsx-a11y work is static.
- **Q-154** — now `Gate: owner`. It is a design call, not a conversion: converting faithfully needs
  **six** primitive props, one of them a decorative halo ring. See the entry.
- **Q-138** — four real extractions left, and the entry says take them *opportunistically when
  already in the file*. Respect that.
- **Q-254** — PARKED, `Needs: Q-297`.
- **Q-111** — ring half shipped; strap/scale halves need a chest strap and a scale in hand.
- **Q-93-followup, Q-112, Q-168** — feature work with **no plan**. Per the backlog-driven protocol
  these need a docs-only planning PR first; do not start implementing one cold.

**So: the next Lane B session should either take a `Gate: device` item to the phone, or write a plan.**
If the Orchestrator has swept LB-12 by then, re-run the tool first — the picture changes completely.

## Do not re-litigate
- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**` are Lane A** whatever the edit
  looks like. Q-403 said "Lane B if the fix is the system prompt in `app/api/coach/route.ts`" — wrong,
  the rule is the **path**, not the nature of the edit. Corrected, along with Q-289/Q-290/Q-291.
- **Scoring changes are nobody's to implement**: Tuning proposes → owner signs off → Lane A builds.
- **Radix `Collapsible`/`CollapsibleTrigger` supplies `aria-expanded`** — never a Q-491 violator.
- **`weekly-stats-hub`'s `todayKey` needs `.replace(/-/g,"/")`** — `/api/weekly-stats` emits `yyyy/MM/dd`.
- **Q-359's remaining 12 sites** — judged not worth converting; the entry is its ratchet's home.

## Owed (device / physical)
**Everything this run shipped is APK-unverified.** Q-406's diary row + delete, Q-499's three error
states, Q-467's Coach undo, Q-315's vacuum picker (needs a **desktop**, not the phone), Q-538's raw-store
findings (**Read stats** on `/admin/oura-ble`), Q-305's band words at S25 width, Q-281's "Final
readiness" row (never rendered at all — the local seed has no `ouraScore` row), Q-477's rollover
across local midnight. Carried: BF-10, LB-5, Q-328/Q-321/Q-486, Q-389 print/scan/share, a TalkBack
pass, Q-450/Q-418 (needs a Polar H10).

## Claimed paths
None held. `scripts/next-item.js` + `scripts/lib/{keep,entry-id}.js` were claimed for LB-11/PS-6 and
released on merge. `scripts/` remains in neither lane's path list — claim it in this file if you take it.

## Gotchas worth carrying
- **Shallow clone: `git fetch --unshallow origin` before every merge**, or `git fetch origin main`
  re-shallows and the merge dies with "refusing to merge unrelated histories."
- **A backlog conflict is almost always TWO DELETIONS** — read headings, keep neither side.
- **`git ls-remote origin 'refs/heads/<name>*'` before pushing** — several names are already taken.
- **`open('f','w').write(open('f').read()…)` TRUNCATES BEFORE IT READS.** Wiped `package.json` to 0
  bytes; every tool then failed with `ERR_INVALID_PACKAGE_CONFIG`, which looks nothing like the cause.
- **A grep count is not a violator list.** Q-491 claimed nine `aria-expanded` violators (two were
  real); Q-281's zero-`.label` grep would have flagged `contributor-chart`, which renders a legend and
  is correct. **Read the files.** This cost nothing each time and removed eight false positives once.
- **An entry's own premise is wrong often enough to always check.** This run: Q-282's headline
  ("no a11y check in CI" — there is one), Q-305 ("never shown" — it was shown, against a made-up
  band), Q-315 ("just needs a press" — nothing could press it), Q-138 (two rows already done),
  Q-467's route calling a **client** cache-invalidation helper server-side, where it clears nothing.
- **Playwright here:** `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`; `/sign-in`'s
  FIRST submit is "Sign in with Google" — click **"Sign in with email"**, then `press('Enter')` on the
  password (the real submit has no accessible name). `serviceWorkers:'block'`, and
  `waitUntil:'domcontentloaded'` on polling consoles.
- **Home's Morning Check-in is a MODAL** — Radix `aria-hidden`s `<main>`, so every `getByRole` on Home
  returns 0 and the failure reads as "the affordance does not exist". Use `suppressMorningCheckin()`.
- **StrictMode's double effect-invoke is real and bites**: LB-10 made five sheets unopenable in
  `pnpm dev` while production was fine.
- **A scratch route needs `rm -rf .next` afterwards**, and sometimes before — "Invariant: missing
  bootstrap script" is a stale `.next`, not your code.
- **`projectOverview.md` sits ON its ratchet almost every PR** — re-measure with
  `check-doc-index-size.js`, compact an older paragraph, never raise the baseline.
- **`get_check_runs` lags 30+ min; attempting the merge is the reliable check.** E2E is NOT a required
  check — it can be red on `main` and nothing stops merges (that is how BF-23/OR-1 happened twice).
- **`pkill -f "next dev"` exits 144 and kills the rest of a compound command** — put it last.
- **The local seed drifts as you probe it.** `first-run-empty-states` and `goal-invalidation` went red
  locally from this session's own inserts and passed in CI. Check before believing a local red.
