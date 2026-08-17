# Implementation Agent (B) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (B) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-17 · **By:** the second Lane B run · **Q band:** 350–386 (next free: **351**)

## Now
Nothing in flight. Two items shipped today:

- **Q-532** (v1.317.6) — `scrollIntoView` on a sentinel inside an `overflow-y-auto` panel scrolls
  every scrollable ancestor including the document, so the ring's debug log dragged the whole page
  on each line during a drain. Both call sites now use `lib/hooks/use-scroll-to-bottom.ts`. The
  sibling sweep found a second, unreported instance in the workout-builder chat.
  [Journal](../../overview/entries/2026-08-17-scroll-panel-page-jump.md).
- **Q-261** (v1.317.4) — the six bare `<Label>`s in `components/profile/` fronting button groups.
  Five became `role="radiogroup"` + `aria-labelledby`; Timezone dropped `<Label>` entirely. Guard:
  `e2e/profile-group-labelling.spec.ts`, both assertions proven lethal by mutation.
  [Journal](../../overview/entries/2026-08-17-profile-group-labelling.md).

## Next
Work the queue top-down and take the highest Lane-B-owned item, re-verifying its premise against
`main` first. **The queue was heavily re-prioritised on 2026-08-17** — a live device session pushed
a block of Q-53x items to the top, so do not trust an older baton's "next item".

Most of the current top is Lane A (Kotlin, sleep-window data, DB sizing). Lane B candidates, in
queue order at the time of writing:

1. **Q-531** `[app-shell][devices]` — ⛔ **blocked, and I marked it so in the file.** It asks for the
   premise of a shipped IA decision (Q-234) to be re-litigated. Do not pick the new structure
   yourself: the entry's own point is that Q-234 reasoned taxonomically, was right on paper and
   wrong in use, and the owner's task walk-through is the missing evidence. Planning output, not
   Lane B implementation.
2. **Q-450** `[activity][cardio]` — `/activity` reached without a type: Save silently discards the
   activity. Check where the fix actually lands before claiming it; it may be the route.
3. **Q-451** `[workouts][app-shell]` — a new account's Workout tab is an empty card with a dead
   "Start Workout" button.
4. **Q-452** `[app-shell][platform]` — the AI insight card runs an LLM over literal "no data"
   strings and tells a day-one user their inactivity is a "significant gap".
5. **Q-309** `[nutrition][app-shell]` — touch tap on Nutrition's action row does not activate the
   button; a synthesised click does. Sank a long way down when the Q-53x block landed.

## Blocked
- **Q-531** — needs an owner decision. Annotated in place with what would unblock it.

## Owed
- **A TalkBack pass on the S25** (Q-261) over More → Goals and More → Edit Profile.
- **A drain run on the S25** (Q-532) confirming `/admin/oura-ble` holds still while the log streams.
  Not reproducible in the sandbox at all — no radio.

## Q numbers used from the band
- **Q-350** — filed, not implemented. Eight `role="radiogroup"`s, none with arrow-key navigation.
  Next to Q-282 in the backlog. Wants one shared `components/ui/` primitive, not eight copies.

## Claimed paths
None beyond the lane list in [`docs/agents/README.md`](../README.md) §3. `lib/hooks/` is already
Lane B's.

## Do not re-litigate
- The lane contract, authority limits and Q bands are settled in
  [`docs/agents/README.md`](../README.md).
- **`radiogroup` beat `group` + `aria-pressed` for pick-one option sets** — majority precedent
  (8 sites vs 1) and the accurate semantic. Q-261's entry suggested `group`; considered, not taken.
- **Arrow-key nav was deliberately left off Q-261's five groups** to match the three that shipped
  without it. That is Q-350's scope, as one sweep.
- **`coach-content.tsx`'s `scrollIntoView` is correct** and was deliberately left alone in the Q-532
  sweep — it has no inner scroll container, so the page is genuinely its scroller.

## Gotchas worth carrying
- **`scripts/check-doc-index-size.js` is a shrink-only baseline on `projectOverview.md`,
  `docs/implementation-backlog.md` and `CLAUDE.md`, and it will fail your PR.** Trim into the
  journal entry first; raise the baseline only for genuinely new index material (a new open
  Known-Issue owing a device check qualifies), and document the raise in that file's comment block
  the way every previous raise is.
- **The E2E harness wants the TCP `DATABASE_URL`**, not the socket form the session hook exports:
  `export DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev'`. Full run
  ~3–4 min for 14 tests.
- **There is no component-test infrastructure.** Both vitest projects are `environment: 'node'` and
  `@testing-library/react` is absent, so you cannot render a component and assert on it. For UI
  behaviour the only automated option is an E2E spec — and that cannot reach admin routes or
  anything needing a radio. Say so plainly rather than implying a fix is guarded.
- **Mutation-check every guard you add** — revert the fix, watch the spec go red. Q-259 is the
  precedent: a spec built for a real bug passed with the fix deleted.
- **`pnpm check:rules` ran 38 of 38 on 2026-08-17.** Quote the count, never "pass" — it moves.
- **`components/ui/label.tsx` resolves to** `flex items-center gap-2 text-sm leading-none font-medium
  select-none …`. Replacing a `<Label>` with a plain element means carrying those classes across.
