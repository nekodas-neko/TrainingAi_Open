# 2026-08-14 — the Health tab's card customiser, deleted rather than rebuilt (Q-238)

**Branch:** `claude/ia-cluster-app-shell` · **Version:** v1.307.2

The entry said to decide: wire the writers up, or delete them. **Deleted.** Git history is what
decided it, and the entry did not have that history.

## What the entry described

`lib/health-card-order.ts` exported `saveHealthCardOrder` and `saveHiddenHealthCards` with no
caller outside their own test, while the readers were live — `health-content.tsx` seeded three
order arrays and a hidden set on every mount, and `health-sections.tsx` plus
`rhr-hrv-spo2-card.tsx` branched on the hidden set in nine places. Confirmed exactly as written.

## What git added

The mechanism was not speculative infrastructure that never got a UI. It **had** one, twice, and
both halves were removed on purpose:

- `4b7614f5` (2026-06-23) added the helpers and their tests.
- `0376da61` added `components/more/health-screen-section.tsx` — card-visibility toggles in
  More → Settings, rendered from `profile-tab.tsx:475`.
- `4e9ecffd` (2026-06-23), *"Remove Health Screen Cards section from More tab"*, deleted the render
  site the next day.
- `077f48e0` (2026-06-24) removed drag-to-reorder from Home and Health: *"Drag was the root cause of
  the scroll lag issues throughout this session."* Its message says show/hide was preserved — by
  then it was already orphaned.
- `73d6d0c3` (2026-06-28) deleted `health-screen-section.tsx` as one of four "dead files (none
  imported anywhere)". True of the file; the helpers and every reader stayed.

So the customiser was tried, pulled deliberately for scroll performance and for being unwanted, and
the machinery underneath it survived by never being the thing anyone was deleting. Rebuilding it now
would re-add what the owner removed, and would place a new entry point that **Q-232's plan has not
decided yet** — the umbrella exists precisely so Settings does not grow another surface ad hoc.

## The half nobody noticed: hidden cards could not be un-hidden

Between `0376da61` and `4e9ecffd` the toggles were live. Anyone who hid a Health card in that window
had `ta_health_hidden` in `localStorage` and, from the next day on, **no UI that could clear it** —
the readers went on honouring it forever. Deleting the readers is what fixes that, which is why the
deletion goes all the way through rather than stopping at the writers. This is the one user-visible
effect and it is in the changelog.

Whether the owner actually hid anything in that one-day window is not knowable from here.

## What was removed

- `lib/health-card-order.ts` and `lib/__tests__/health-card-order.test.ts`.
- `health-content.tsx`: the import, four state hooks, three `*OrderRef` refs and their sync effects
  (themselves leftovers from the drag handlers `077f48e0` removed — nothing read them), and the
  seeding `useLayoutEffect`. `TRAINING_DEFAULT_ORDER`/`PROGRESS_DEFAULT_ORDER` are now
  `TRAINING_ORDER`/`PROGRESS_ORDER`, since "default" implied an override that no longer exists.
  `BODY_DEFAULT_ORDER` is gone — it was `BODY_GROUPS.flatMap(g => g.cards)`, so
  `g.cards.filter(k => bodyOrder.includes(k) && …)` filtered on a superset of itself.
- `health-sections.tsx`: the ctx field, the `isSectionVisible` guard, and six `showX` flags gating
  three two-column grids (steps/distance, burned/BMI, trend/balance).
- `rhr-hrv-spo2-card.tsx`: the prop and three flags gating the RHR/HRV/SpO₂ tiles and their
  "vs your recent days" scales.

Rendering is unchanged: with the hidden set permanently empty, every one of those flags was already
constant `true`.

## Verification

`npx tsc --noEmit` · `pnpm lint` (no new warnings) · `pnpm build` · **`pnpm check:rules` — Ran 33 of
33** · full suite **469 files / 3,883 tests green**.

`pnpm dev` at a 412×915 viewport, signed in as `test@local.dev`: all three Health tabs render with
zero console errors. Body shows both halves of each edited grid (Steps · Dist, Burned · BMI,
Trend · Balance) and the full RHR/HRV/SpO₂ trio with its scales; Training renders all seven cards;
Progress all five.

No new test was added, so there is no guard to mutation-verify — the change deletes a test rather
than adding one. The suite's discrimination here is the type checker: every reference site had to
come out for `tsc` to pass.

**Not exercised:** the S25 APK. No layout, safe-area or sheet geometry changed — the removed
wrappers were `{flag && (…)}` around cards that always rendered — so this is a low-risk web-verified
change, but it has not been seen on device.

## If the customiser is wanted later

Build it inside Q-232's Settings structure, not by restoring these 62 lines. Two things about the
deleted version should not be copied: it stored to `localStorage`, which Q-241 has just finished
removing as a source of truth for user preferences, and it carried a dated one-time-reset flag
(`ta_health_progress_order_reset_2026_07_21`) to force stale saved orders back to the default — a
mechanism that exists only because the stored order can drift from the code's.
