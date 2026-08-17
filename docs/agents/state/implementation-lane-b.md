# Implementation Agent (B) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (B) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-17 · **By:** the fourth Lane B run · **Q band:** 350–386 (next free: **353**)

## Now
Nothing in flight. Four items shipped today:

- **Q-451** (v1.318.3) — a new account's Workout tab was an empty card with a dead Start button.
  Now an empty state with a Create-a-program CTA.
  [Journal](../../overview/entries/2026-08-17-workout-select-empty-state.md).
- **Q-450** (v1.318.1) — `/activity` with no type recorded an activity and discarded it on Save.
  [Journal](../../overview/entries/2026-08-17-activity-untyped-entry.md).
- **Q-532** (v1.317.6) — `scrollIntoView` on a sentinel dragged the whole page.
  [Journal](../../overview/entries/2026-08-17-scroll-panel-page-jump.md).
- **Q-261** (v1.317.4) — six bare `<Label>`s fronting button groups.
  [Journal](../../overview/entries/2026-08-17-profile-group-labelling.md).

## Next
Work the queue top-down and take the highest Lane-B-owned item, re-verifying its premise against
`main` first. **The queue re-prioritises daily** — re-read it rather than trusting this list.

Most of the current top is Lane A (Kotlin, sleep windows, DB sizing). Lane B candidates in order:

1. **Q-452** `[app-shell][platform]` — the AI insight card fires `POST /api/ai/health-insight` on
   every mount with no sufficiency gate, and the route substitutes the literal string `"no data"` for
   absent fields. A day-one user is told their "inactivity creates a significant gap". **Check the
   lane split before starting**: the card is `components/health/ai-insight-card.tsx` (Lane B), the
   prompt is `app/api/ai/health-insight/route.ts` (Lane A). A client-side sufficiency gate is
   entirely Lane B and is probably the right first cut; changing the prompt is not yours.
2. **Q-309** `[nutrition][app-shell]` — a touch tap on Nutrition's action row does not activate the
   button; a synthesised click does. `e2e/water-log-write-path.spec.ts` documents this from the
   harness side and works around it with `dispatchEvent('click')`.
3. **Q-352** — the zero-data E2E fixture this session filed. Touches `scripts/local-db/`, which is
   neither lane's; claim it in this baton first. Read the trap in its entry before starting.
4. **Q-350** — the radiogroup keyboard sweep. Low priority.
5. **Q-531** — ⛔ blocked, see below.

## Blocked
- **Q-531** `[app-shell][devices]` — needs an owner decision, annotated in the backlog. It asks for
  the premise of a shipped IA decision (Q-234) to be re-litigated; do not pick the new structure
  yourself, since the entry's own point is that Q-234 reasoned taxonomically and was wrong in use.

## Owed
- **A TalkBack pass on the S25** (Q-261) over More → Goals and More → Edit Profile.
- **A drain run on the S25** (Q-532) confirming `/admin/oura-ble` holds still while the log streams.
- **Q-450's device path** — the E2E run took the web fallback, not SQLite+outbox.
- **Q-451 has no committed guard** — observed working against a temporary account, then removed.
  Q-352 is what fixes that.

## Q numbers used from the band
- **Q-350** — eight `role="radiogroup"`s, none with arrow-key navigation. Wants one shared primitive.
- **Q-351** — **Lane A's to fix.** A sub-3-second activity rounds `durationMin` to 0 and
  `ActivityLogBody.durationMin` is `.positive()`, so the POST 400s and the activity is lost behind a
  generic toast. Measured (2 s → 400, 5 s → 201). The outbox parses the same schema.
- **Q-352** — the E2E harness has no zero-data account, so no first-run bug can be guarded.

## Claimed paths
None beyond the lane list in [`docs/agents/README.md`](../README.md) §3. **Q-352 will need
`scripts/local-db/`**, which is neither lane's — claim it here before touching it.

## Do not re-litigate
- The lane contract, authority limits and Q bands are settled in
  [`docs/agents/README.md`](../README.md).
- **Q-451's `programLoaded` is never set in a `finally`.** A failed first load with no cache holds
  the skeleton instead of claiming the account has no program. Telling someone with a program "No
  program yet" because their network dropped is the worse failure; the header's Refresh resolves it.
- **The inert Start button was removed, not disabled.** A disabled primary CTA still asserts "this is
  the thing to do here", which is false when the prerequisite is elsewhere.
- **Home's `recommendation-card.tsx:281` is NOT the Q-451 bug** — same `x && f(x)` shape, but inside
  a `displaySession ?` branch, so it is redundant defence. Swept and cleared; don't re-file it.
- **Q-450's guard belongs at the destination, not the call sites** — a cold open reaches `/activity`
  with no call site at all.
- **`radiogroup` beat `group` + `aria-pressed`** for pick-one option sets (8 sites vs 1).
- **`coach-content.tsx`'s `scrollIntoView` is correct** — no inner scroll container, so the page is
  genuinely its scroller.

## Gotchas worth carrying
- **`scripts/check-doc-index-size.js` is a shrink-only baseline** on `projectOverview.md`,
  `docs/implementation-backlog.md` and `CLAUDE.md`, and it *will* fail your PR. Trim into the journal
  entry first. Striking a finished item usually fits without a raise; when it genuinely does not,
  raise it and document why in that file's comment block, as every previous raise does.
- **The E2E harness wants the TCP `DATABASE_URL`**, not the socket form the hook exports:
  `export DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev'`.
- **Every spec runs as one seeded user who has a program, logs and metrics** — so no empty state or
  first-run path is reachable from a committed spec. To verify one, insert a temporary user
  (copy `password_hash` from `test@local.dev`), drive a throwaway spec with
  `test.use({ storageState: { cookies: [], origins: [] } })`, then delete both. Sign-in needs
  `getByLabel('Email')` and the button named `/sign in with email/i` — a looser regex matches two
  elements and fails on strict mode.
- **Write E2E specs for real flows — they find things reading cannot.** The Q-450 spec failed on its
  first run for an unrelated reason, which is how Q-351 was found.
- **`.click()` does not always activate a button in the mobile context** — see Q-309 and the note in
  `e2e/water-log-write-path.spec.ts`. First suspect when a click silently does nothing.
- **Clear `localStorage` with `page.addInitScript` before `goto`** when a spec depends on a Zustand
  persisted store's initial state.
- **There is no component-test infrastructure** — both vitest projects are `environment: 'node'` and
  `@testing-library/react` is absent. E2E is the only automated route to UI behaviour.
- **Mutation-check every guard you add** — revert the fix, watch the spec go red (Q-259's lesson).
- **`pnpm check:rules` ran 38 of 38 on 2026-08-17.** Quote the count, never "pass" — it moves.
