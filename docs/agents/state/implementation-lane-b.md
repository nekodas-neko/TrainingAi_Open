# Implementation Lane B — state

**Last written:** 2026-08-17 · **Branch:** `claude/implementation-lane-b-0o7kb9`

> This file is the baton. Rewrite it **in full** at the end of a session — never append. It is the
> first thing the next Lane B session reads.

## First session note

`docs/agents/` did not exist when this lane first ran on 2026-08-17, so there was no baton to pick
up and no `docs/agents/README.md` to read. This file was created by that session. The lane contract
below is what was given in the session prompt, recorded here so it survives; **if a
`docs/agents/README.md` appears later, it is the authority and this summary defers to it.**

## Lane contract (as given)

- **Owns:** `app/**` except `app/api/**` · all of `components/**` · `app/globals.css` ·
  `lib/hooks/**` · `lib/stores/**` · plus small client-side helpers.
- **Lane A owns:** data, sync, scoring, server routes, device pipelines. A path neither lane lists
  is claimed in this file before being touched, after checking Lane A's baton.
- **Q band: 350–386.** Take numbers directly from it. Do **not** read or write the backlog's
  next-free pointer — the bands exist so the lanes never race for a number.
- **No migration numbers at all.** An item that turns out to need a schema change stops and goes to
  Lane A.
- **Authority:** push, open a PR, merge a tested CI-green change without asking. Ask first for
  anything data-dropping or non-reversible, anything touching auth/session/security or secrets, and
  any scoring or formula change originating from the Tuning agent.

## In flight

Nothing. The session's work is merged.

## Q numbers used from the 350–386 band

- **Q-350** — filed, not implemented. Eight `role="radiogroup"`s in the app, none with arrow-key
  navigation. In the backlog next to Q-282 (CI accessibility scanning), which is the entry that will
  surface it automatically. Wants one shared `components/ui/` primitive across all eight sites, not
  eight hand-rolled copies.

**Next free in band: 351.**

## What this session did

Q-261 — the six bare `<Label>`s in `components/profile/` that front button groups rather than
controls. Five became `role="radiogroup"` + `aria-labelledby` (house precedent, three sites already
did this); Timezone dropped `<Label>` because nothing was being labelled, and its "Auto-detect"
button was renamed "Auto-detect timezone". Shipped v1.317.4. Guard:
`e2e/profile-group-labelling.spec.ts`, both assertions proven lethal by mutation.

Journal: [`docs/overview/entries/2026-08-17-profile-group-labelling.md`](../../overview/entries/2026-08-17-profile-group-labelling.md).

## Owed, and by whom

- **A TalkBack pass on the S25 over More → Goals and More → Edit Profile.** Owner or a device
  session. Chromium's accessibility tree was asserted; the announcement itself was not heard. This
  is why the Q-261 Known-Issues row stays in `projectOverview.md` rather than moving to
  `docs/overview/known-issues-resolved.md`.

## Things worth knowing next time

- **`pnpm check:rules` ran 36 of 36 on 2026-08-17.** Quote the count, never the word "pass" —
  CLAUDE.md says so and the number moves (31 → 33 → 36).
- **The E2E harness wants the TCP `DATABASE_URL`**, not the socket form the session hook exports:
  `export DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev'`. A full
  `pnpm e2e` was 2.7 minutes for 14 tests; a `-g`-filtered run is under a minute.
- **Mutation-check every guard you add.** Q-259 is the precedent: a spec was built for a real bug,
  passed with the fix deleted, and had to be closed as not-achievable. Reverting the fix and
  watching the spec go red takes one run and is the difference between a guard and decoration.
- **Two competing ARIA shapes exist in this repo for option groups** — `role="radiogroup"` +
  `aria-checked` (now 8 sites) and `role="group"` + `aria-pressed` (`nutrition/ingredient-row.tsx`).
  Prefer radiogroup for pick-one; it is the majority and the accurate semantic.
- **`components/ui/label.tsx` resolves to** `flex items-center gap-2 text-sm leading-none
  font-medium select-none …`. Replacing a `<Label>` with a plain element means carrying those
  classes across, or the spacing shifts.
- The backlog's queue is not sorted purely by Lane B relevance — most of the top items are Lane A
  (server routes, scoring, CI). Read down until an item lands inside `components/**` or `app/**`.

## Next action for the next Lane B session

Work the backlog queue top-down and take the highest item inside Lane B's ownership, re-verifying
its premise against current `main` first. As of 2026-08-17 the queue's Lane-B-owned candidates,
in queue order, were:

1. **Q-309** (`[nutrition][app-shell]`) — a touch tap on Nutrition's action row does not activate
   the button while a synthesised click does. Around line 2282 of the backlog. This is the highest
   Lane B item now that Q-261 is done, and it is a live interaction bug rather than a polish item.
2. **Q-350** — the radiogroup keyboard sweep this session filed. Low priority; it is fine to leave
   for the Q-282 scanner to force.

Everything above Q-309 in the queue at that time was Lane A's (Q-310 `app/api/workout-data`, Q-306
CI publish gate, Q-307 MET table, Q-263 cache-group audit, and the scoring/model entries).
