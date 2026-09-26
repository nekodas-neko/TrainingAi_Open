# Handoff — 2026-09-26 · Cat collection art, and the v2 rules it is waiting for

_Domain: `app-shell` (also touches `platform` for the widget, `devices` for PS-50) · Branch:
`art/cat-collection-art` then `feat/collection-pen-widget` · PRs: [#1694](https://github.com/nekodas-neko/TrainingAi_Open/pull/1694)
(merged) and the pen PR on `feat/collection-pen-widget`, merged by this session once CI was green, at the
owner's instruction_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/app-shell/README.md`, then `docs/implementation-backlog.md` (PS-48, PS-49, PS-50,
> PS-51, BF-126). This file covers only what this one-off session did and what it leaves behind.

## Goal

Unpark BF-126 (the collection's drawn art, gated on an asset since 2026-09-15) by having the session
author the asset itself. The owner then widened the brief into a v2 ruleset. That was planned here
and deliberately not built.

## Current status

- **Build/test:** `pnpm check:rules` ran 80 of 80, exit 0. Collection unit tests: 5 files / 43
  tests. eslint is clean on touched files and `tsc --noEmit` exits 0. CI was green on #1694.
- **`pnpm dev`:** partial. The real `CatSprite` rendered on the dev server via a temporary public
  page (not committed). **The signed-in Home card was never run**: the owner's Windows machine has
  no local Postgres.
- **Device-verified: no.** There is a Known-Issues row in `projectOverview.md`, and BF-126 carries
  `Verify: owner` (a looks judgement, so it is Lane O, not DV).

## What shipped (#1694, v1.466.0, JS-only, so no APK)

- `public/cats/{tank,ranger,rogue,cleric}-{1..5}.svg`: 20 flat-vector sprites.
- `scripts/collection-art/cat.mjs` (base cat + palettes), `gear.mjs` (per-tier gear) and
  `build.mjs` (writes the SVGs; `--check` for drift).
- `components/home/cat-sprite.tsx`: `CatSprite`, with the glyph fallback and a mount-time check for
  a load that failed before hydration.
- `components/home/collection-sprites.ts`: `LADDER_CLASS` (workout→tank, steps→ranger,
  sleep→cleric) and `tierArt()`. The glyphs are kept.
- `components/home/collection-card.tsx` (56 px) and `app/collection/collection-content.tsx` (48 px,
  labels stacked under the sprites).
- `components/home/__tests__/collection-sprites.test.ts`: fails if an SVG drifts from its source.
- Docs: plan `docs/superpowers/plans/2026-09-26-cat-collection-rules-v2.md`; PS-48/49/50; BF-126
  rewritten; journal `docs/overview/entries/2026-09-26-art-cat-collection-art.md`.

## Deliberately NOT done

- **The v2 engine (PS-49).** It lives in `packages/shared` and `app/api`, which are Lane A's paths,
  and this session was a one-off. Not a lane.
- **The Android home-screen widget (PS-50).** It is Kotlin and needs an APK.
- **The owner's cat counts under v2.** The read-only DB query secret was not usable from that
  machine. PS-49 must measure them on production before it merges; the owner asked for exactly
  this.
- **LA-76** (deload phase dating). The prompt fenced it off, and it stays Lane A's.

## Key decisions (with rationale)

- **Flat vector, not pixel art.** The owner rejected the 24×24 pixel draft outright and supplied
  references. Do not revisit.
- **Static SVGs generated from a script**, not inline JSX. That keeps the source diffable, keeps
  hex out of `.tsx` (so the hex ratchet is untouched), lets the SW cache the files, and gives PS-50
  convertible files.
- **Rendered at 48–56 px, not emoji size.** BF-126's own warning was detail at 32 px; the answer
  was size.
- **Four classes, steps and cardio separate.** Owner's choice.
- **Drain is constant and movement counteracts it** (owner). This deliberately reverses v1's
  gap-only decay.
- **The healer is the "Health cat"**, which earns points for sleep, nutrition and weight logging
  (owner, late in the session). The points numbers in the plan are the session's proposal and the
  owner has not seen them.
- **The art keeps the internal name `cleric`.** The display name is PS-49's call when it renames
  the tiers.

## Gotchas / what did NOT work

- **`/cats/*.svg` sits behind `middleware.ts`'s auth matcher.** Signed in it is fine. Signed out, or
  from native code, it 307s to `/sign-in`. That is how the hydration race was found, and PS-50 must
  bundle the art rather than fetch it.
- **Hydration race:** a server-rendered `<img>` that fails before hydration never fires React's
  `onError`. Fixed in `CatSprite`; copy that pattern for any other fallback image.
- **Shared checkout:** another session had an uncommitted `scripts/device/cdp.js` edit in
  `D:\Projects\TrainingAi_Open`. This work was done in the worktree
  `D:\Projects\TrainingAi_Open-cats` to avoid it. The stray local branch
  `art/cat-collection-sprites` in the shared checkout holds only the first commit of this work,
  which is superseded by #1694, and can be deleted.
- `pnpm typecheck:tests` cannot spawn `npx.cmd` on Windows (Node 22). Run
  `npx tsc --noEmit -p tsconfig.tests.json` and compare against the baseline instead.

## Second pass, same session: the pen (v1.467.0)

- **Home card = `CollectionPen`**: every held cat wandering over a backdrop scene, using the whole
  card. Self-animating sprites (tail, paws, blink, three poses per loop), a mythic **T6** for every
  class, a **shiny** recolour of every tier, and four **scenes** (meadow default, forest, house,
  castle). 52 generated files, all covered by the drift test.
- **Decided:** workout tiers 1·5·20·100·300·900 sessions; workout decay is per-user and gap-only
  (`maxCompliantRestGap`), not a constant drain, because the owner's own rule (*"2 days of not
  training doesnt kill any … but 3 would"*) is exactly that and it adapts to any schedule. Rares and
  lucky procs must be pure functions of the day. All in the plan.
- **Gotcha:** the dev browser keeps stale CSS/JS chunks, because Next dev reuses chunk filenames
  when their content changes. It produced a no-animation render and phantom hydration mismatches.
  Refetch chunks with `cache: 'reload'`, or use a fresh headless profile, before debugging code.
- **Unmeasured:** the pen's frame rate with a dozen filtered, animated sprites on Samsung's WebView.
  If it stutters, drop the rim filter from the animated group first.

## Third pass, same session: named cats (v1.468.0)

- **`replayCollection` now holds real, named cats** (`names.ts` + the lineage fold in
  `ladder.ts`). The rules are the same and the counts are derived, so all prior tests pass. Merges
  blend names; decay breaks a big cat back into the same named cats. The state gains `cats`,
  `restless` and `lastLost`. **This touched Lane A's `ladder.ts` at the owner's request**; PS-49 is
  told to keep the fold.
- **Pen:** name tags, depth by tier (small in front, big further back and higher), and flying
  T5–T6. **Card:** named restless warning and named "wandered off". **`/collection`:** a roster
  with arrival day and parents.
- **PS-52 (Lane O):** attachment ideas for the owner to pick from; the recommended three are a named
  nudge notification, merge moments and anniversaries.

## Open questions / blockers

- **PS-48 (Lane O, #1 in O's READY list):** ② the Rogue's cardio unit and drain, and ④ re-scoring
  history from scratch. ① (the Health cat) and ③ (six tiers) were answered in-session.
- **PS-51:** which title unlocks which scene. The proposal is in the entry; it is the owner's call.
- **BF-126 `Verify: owner`:** does the drawn cat read better than the emoji on the S25?

## Pickup prompt

```
You are picking up the cat collection work after the art session of 2026-09-26. Everything from
that session is merged to main (#1694 v1.466.0, #1706 v1.467.0, and the named-cats PR v1.468.0).

Read in order:
  1. projectOverview.md — the "collection cats are drawn now" Known-Issues row
  2. docs/domains/app-shell/README.md
  3. docs/handoff-2026-09-26-app-shell-cat-collection-art.md
  4. docs/superpowers/plans/2026-09-26-cat-collection-rules-v2.md
  5. docs/implementation-backlog.md — PS-48, PS-49, PS-50, PS-51, PS-52, BF-126 (grep for them)

If you are the Orchestrator: first action is PS-48 — put its two remaining questions (Rogue cardio
rate, re-score history) to the owner, plus PS-51's title→scene mapping and PS-52's pick, in the "Decisions That Come Back To Me" shape, and
record the answers in PS-48 and the plan. Also route BF-126's owner look into his next S25 sitting.

If you are Lane A: PS-49's steps, workout and Health-cat halves can start now; only the cardio
faucet waits on PS-48. The workout ladder needs only new LADDERS constants (six tiers, costs
5·4·5·3·3) — v1's gap-only decay is already the owner's rule. Before merging, replay the owner's production history under v2 and put his
resulting cat counts in the PR — he asked for that explicitly. Bump COLLECTION_RULES_VERSION to 2;
no migration is needed (the collection is replayed). CatSprite and CollectionPen already render six
tiers and shinies; add a `shiny` flag to the route's payload when the rares land.

Constraints: dark theme only; nothing here is device-verified; /cats/*.svg is behind the auth
middleware (PS-50 must bundle the art in the APK); edit the art only through
scripts/collection-art/ and re-run build.mjs — a test fails on drift. Do not touch LA-76 as part
of this.
```
