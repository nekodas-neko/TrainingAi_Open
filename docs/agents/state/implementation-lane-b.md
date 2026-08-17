# Implementation Agent (B) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (B) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-17 · **By:** the fifth Lane B run · **Q band:** 350–386 (next free: **356**)

## Now
Nothing in flight. Nine items closed today:

- **Q-350 + Q-355** (v1.318.7) — all eight radiogroups now share `lib/hooks/use-roving-radio-group.ts`
  for arrow keys and a roving tabindex (a **hook**, not the component the entry proposed), and the
  three goal groups no longer eject keyboard focus mid-save.
  [Journal](../../overview/entries/2026-08-17-radiogroup-keyboard-nav.md).

- **Q-457** — `lib/github-release.ts` defaulted `APK_RELEASE_REPO` to the archived private repo.
  Now defaults to the public one, guarded by a test on the URL actually requested.
  [Journal](../../overview/entries/2026-08-17-apk-release-repo-default.md).

- **Q-352** — the E2E harness now has a zero-data account (`e2e/zero-data.setup.ts`), and Q-451 and
  Q-452 are guarded by `e2e/first-run-empty-states.spec.ts`. Carries a **correction** to yesterday's
  Q-452 claim about the heart-rate fields.
  [Journal](../../overview/entries/2026-08-17-zero-data-e2e-fixture.md).

- **Q-309 REFUTED** — a real touch tap on Nutrition works; `.click()` sends a mouse sequence with no
  touch events, so the suspected `filterTaps` tap-swallowing cannot be it. Spec now uses
  `touchscreen.tap()`. Residue is **Q-354**.
  [Journal](../../overview/entries/2026-08-17-nutrition-tap-refuted.md).

- **Q-452** (v1.318.6) — the AI insight card commented on data that did not exist. `AiInsightCard`
  now takes a required `hasData`. **Client half only — the prompt half is Q-353, Lane A's.**
  [Journal](../../overview/entries/2026-08-17-ai-insight-sufficiency-gate.md).
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

**Lane B's queue is drained.** What is left is one low-priority item this lane filed itself, and one
blocked on the owner:

1. **Q-354** — the mouse-click residue of Q-309. Low priority (no supported user produces mouse
   input), and its entry says do **not** change gesture code without reproducing a *touch* failure
   first — the touch path is verified working.
2. **Q-531** — ⛔ blocked on an owner decision, see below.

Everything else in the queue is Lane A's (Kotlin/BLE, sleep-window data, DB sizing, migrations,
scoring) or was routed there by this lane: **Q-351** (activity `durationMin` 0 → 400) and **Q-353**
(the health-insight prompt's "no data"). If a new Lane B item has not appeared, the useful next move
is to pick up Q-354 or Q-355 rather than to reach into Lane A's band.

## Blocked
- **Q-531** `[app-shell][devices]` — needs an owner decision, annotated in the backlog. It asks for
  the premise of a shipped IA decision (Q-234) to be re-litigated; do not pick the new structure
  yourself, since the entry's own point is that Q-234 reasoned taxonomically and was wrong in use.

## Owed
- **A TalkBack pass on the S25** (Q-261) over More → Goals and More → Edit Profile.
- **A drain run on the S25** (Q-532) confirming `/admin/oura-ble` holds still while the log streams.
- **Q-450's device path** — the E2E run took the web fallback, not SQLite+outbox.
- ~~Q-451/Q-452 unguarded~~ — **closed by Q-352**; both now have mutation-checked specs.

## Q numbers used from the band
- **Q-350** — DONE (v1.318.7).
- **Q-355** — DONE (v1.318.7), fixed alongside Q-350 rather than left half-shipped.
- **Q-351** — **Lane A's to fix.** A sub-3-second activity rounds `durationMin` to 0 and
  `ActivityLogBody.durationMin` is `.positive()`, so the POST 400s and the activity is lost behind a
  generic toast. Measured (2 s → 400, 5 s → 201). The outbox parses the same schema.
- **Q-352** — DONE. Zero-data E2E account + first-run guards.
- **Q-354** — a mouse click on Nutrition's action row reaches the element and the handler does not
  run, this screen only. Touch works. Low priority on a touch-only target.
- **Q-353** — **Lane A's to fix.** The health-insight prompt substitutes the literal `"no data"` for
  absent fields and the model reads it as a measured zero. Q-452 closed the fully-empty case from the
  client; a scored section missing one field still misreports.

## Claimed paths
- **`lib/github-release.ts`** + `lib/__tests__/github-release.test.ts` — neither lane lists them;
  taken for Q-457 with Lane A's baton showing no claims. Release the claim when convenient.

Otherwise the lane list in [`docs/agents/README.md`](../README.md) §3. Note **Q-352 did NOT need
`scripts/local-db/`** in the end — the zero-data account is created by the Playwright setup instead,
which is why the local/CI seeding asymmetry never arose.

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
- **Q-309's `filterTaps` hypothesis is refuted by measurement** — the failing input produces no
  touch events at all. Do not re-derive it, and do not change gesture code off it.
- **`coach-content.tsx`'s `scrollIntoView` is correct** — no inner scroll container, so the page is
  genuinely its scroller.
- **Q-452 gates in the client, not the route** — a client gate costs no request at all, where a
  server-side `{ insight: null }` still pays one.
- **The heart-rate `hasData` gate uses the trend series** because that mirrors what the *prompt*
  reads (`body_metrics`). **Not** because `data.hrMin`/`recentHrv` are broken — an earlier note here
  claimed they were live-ring-only and null, and that was wrong (`recentHrv` is 65 for the seeded
  user). The `card=0` reading behind it was a cold-compile timing artifact. Corrected 2026-08-17.

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
  Q-452's first guard **passed** under mutation and had to be rewritten to assert on the *request*
  rather than on what rendered. Asserting "the card is absent" is not a guard when the card is absent
  either way.
- **A long-lived local DB ages out of its seeded window.** `seed.sql` fills 14 days ending at the
  *user's* Brisbane today, and `setup.sh` will not re-seed a non-empty `users` table — so once the
  session crosses Brisbane midnight (14:00 UTC), "today" has no metrics and
  `e2e/goal-invalidation.spec.ts` fails locally while CI (fresh seed every run) stays green. It is
  not a regression. Top up today's `body_metrics` row rather than debugging the app. Verified by
  stashing all changes and watching it fail on clean `main` too.
- **A fixed short wait is not a measurement on a cold dev server.** A 6 s probe read a not-yet-loaded
  `/api/readiness-score` as "no data" and produced a wrong, confidently-stated finding. Use `toPass`
  with a real budget; `SKELETON_TIMEOUT_MS` is 20 s and `goal-round-trip` records 39.7 s cold.
- **`pnpm check:rules` ran 38 of 38 on 2026-08-17.** Quote the count, never "pass" — it moves.
