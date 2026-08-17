# Implementation Agent (B) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (B) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-17 · **By:** the third Lane B run · **Q band:** 350–386 (next free: **352**)

## Now
Nothing in flight. Three items shipped today:

- **Q-450** (v1.318.1) — `/activity` with no activity type recorded a whole activity and discarded
  it on Save. `/activity` now renders a type picker; the bail-out toasts instead of returning bare.
  [Journal](../../overview/entries/2026-08-17-activity-untyped-entry.md).
- **Q-532** (v1.317.6) — `scrollIntoView` on a sentinel scrolls every scrollable ancestor, so a
  streaming panel dragged the whole page. Both sites use `lib/hooks/use-scroll-to-bottom.ts`.
  [Journal](../../overview/entries/2026-08-17-scroll-panel-page-jump.md).
- **Q-261** (v1.317.4) — the six bare `<Label>`s in `components/profile/` fronting button groups.
  [Journal](../../overview/entries/2026-08-17-profile-group-labelling.md).

## Next
Work the queue top-down and take the highest Lane-B-owned item, re-verifying its premise against
`main` first. **The queue re-prioritises daily** — a live device session pushed a block of Q-53x
items to the top on 2026-08-17 — so re-read it rather than trusting this list.

Most of the current top is Lane A (Kotlin, sleep windows, DB sizing). Lane B candidates in order:

1. **Q-451** `[workouts][app-shell]` — a new account's `/workout-select` is a ~1,400 px empty card
   with a **Start Workout** button that is not disabled and does nothing
   (`workout-select-content.tsx:412` short-circuits on a missing `currentSession`). `/program`
   handles the same account correctly, so there is a good empty state to copy. Now top of the queue.
2. **Q-452** `[app-shell][platform]` — the AI insight card runs an LLM over literal `"no data"`
   strings and tells a day-one user their inactivity is a "significant gap". Needs a sufficiency
   gate; check whether the fix lands in the card or the prompt builder before claiming it.
3. **Q-309** `[nutrition][app-shell]` — a touch tap on Nutrition's action row does not activate the
   button; a synthesised click does. Note `e2e/water-log-write-path.spec.ts` already documents this
   from the harness side and works around it with `dispatchEvent('click')`.
4. **Q-531** — ⛔ blocked, see below.

## Blocked
- **Q-531** `[app-shell][devices]` — needs an owner decision, annotated in the backlog. It asks for
  the premise of a shipped IA decision (Q-234) to be re-litigated; do not pick the new structure
  yourself, since the entry's own point is that Q-234 reasoned taxonomically and was wrong in use.

## Owed
- **A TalkBack pass on the S25** (Q-261) over More → Goals and More → Edit Profile.
- **A drain run on the S25** (Q-532) confirming `/admin/oura-ble` holds still while the log streams.
  Not reproducible in the sandbox — no radio.
- **Q-450's device path** — the E2E run took the web fallback, not SQLite+outbox.

## Q numbers used from the band
- **Q-350** — filed. Eight `role="radiogroup"`s, none with arrow-key navigation. Wants one shared
  `components/ui/` primitive, not eight copies.
- **Q-351** — filed, **Lane A's to fix**. A sub-3-second activity rounds `durationMin` to 0 and
  `ActivityLogBody.durationMin` is `.positive()`, so the POST 400s and the activity is lost behind a
  generic "Failed to save activity". Measured both ways (2 s → 400, 5 s → 201). The outbox parses
  the same schema, so it is a poison-pill candidate too.

## Claimed paths
None beyond the lane list in [`docs/agents/README.md`](../README.md) §3.

## Do not re-litigate
- The lane contract, authority limits and Q bands are settled in
  [`docs/agents/README.md`](../README.md).
- **Q-450's guard belongs at the destination, not the call sites.** Fixing the Coach handoff and the
  guided-walk Done button individually was considered and rejected: `resetSession()` makes the
  typeless state normal, and a cold open or refresh reaches it with no call site at all.
- **The guard is only on `mode === 'pre'`** — an in-flight `'active'` session with a missing type
  keeps its own screen. Throwing it to a picker would destroy the session.
- **`radiogroup` beat `group` + `aria-pressed`** for pick-one option sets (8 sites vs 1).
- **`coach-content.tsx`'s `scrollIntoView` is correct** and was deliberately left alone in the Q-532
  sweep — no inner scroll container, so the page is genuinely its scroller.

## Gotchas worth carrying
- **`scripts/check-doc-index-size.js` is a shrink-only baseline** on `projectOverview.md`,
  `docs/implementation-backlog.md` and `CLAUDE.md`, and it *will* fail your PR. Trim into the journal
  entry first; raise the baseline only for genuinely new index material, and document the raise in
  that file's comment block the way every previous raise is. Striking a finished item and replacing
  it with a shorter fixed-summary usually fits without a raise.
- **The E2E harness wants the TCP `DATABASE_URL`**, not the socket form the hook exports:
  `export DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev'`. Full run is
  ~4½ min for 16 tests; use `-g` while iterating.
- **Write E2E specs for real flows — they find things reading cannot.** The Q-450 spec failed on its
  first run for a reason unrelated to the fix, which is how Q-351 was found. A fix that unblocks a
  path can expose the next defect down it.
- **`.click()` does not always activate a button in the mobile context** (`hasTouch`, `isMobile`) —
  see the long note in `e2e/water-log-write-path.spec.ts` and Q-309. It worked fine for the activity
  screens; if a click silently does nothing, that is the first suspect, not your handler.
- **Clear `localStorage` with `page.addInitScript` before `goto`** when a spec depends on a Zustand
  persisted store's initial state, or a previous run masks the case under test.
- **There is no component-test infrastructure** — both vitest projects are `environment: 'node'` and
  `@testing-library/react` is absent. E2E is the only automated route to UI behaviour, and it cannot
  reach admin routes or anything needing a radio.
- **Mutation-check every guard you add** — revert the fix, watch the spec go red. Q-259 is the
  precedent: a spec built for a real bug passed with the fix deleted.
- **`pnpm check:rules` ran 38 of 38 on 2026-08-17.** Quote the count, never "pass" — it moves.
