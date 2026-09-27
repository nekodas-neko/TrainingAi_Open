# Session journal — batch folded 2026-09-27

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-26-bf61-web-path-clears"></a>

# The swipe tray's Delete works on the web at every delay, so the cause is somewhere else

Implementation Lane B, 2026-09-26. `BF-61`, taken as work after `OR-176` reopened it — and handed
to Device Verification rather than fixed a third time.

## What this session actually established

Sweep 4a gave the defect a number for the first time: from a verified-closed tray, a real
`adb input tap` on Delete's own rect at **0 / 100 / 200 / 300 ms after the swipe is swallowed
(8 of 8)** and at **500 ms it works (2 of 2)**.

That window is **far wider than a CDP round-trip** — which sweep 3's was not — so for the first
time the Playwright harness could aim at it. Probed at 0, 100, 300 and 500 ms after a released
200 px swipe, with the natural 220 ms transition and no stretching: **the confirmation appeared
4 of 4**, and the row's transform read `matrix(1,0,0,1,0,0)` every time, meaning the button's
`onClick` ran and called `close()`.

The probe is kept as a test — *"a tap the instant the swipe ends opens the confirmation"* in
`e2e/food-log-swipe-delete.spec.ts`.

## What that rules out

Re-read for this, and all of it behaves: the gesture maths, the `offset < 0` raise that v1.465.62
shipped, the `aria-hidden`/`tabIndex` flag, and the wiring from the tray's button to the parent's
confirmation. The tray is a later-painting `z-10` sibling of a `z-auto` row, so hit-testing
resolves to the tray for the whole slide.

**The tray does nothing else during the slide.** There is no timer, no guard and nothing with a
~500 ms lifetime anywhere in `swipe-actions.tsx`, `swipe-actions-math.ts`, `meal-card.tsx` or the
nutrition day-swipe — which is what the entry asked to be checked before that line was touched
again.

And the obvious WebView explanation is excluded too: `app/layout.tsx` sets `userScalable: false`
with `maximumScale: 1`, so Chromium's 300 ms double-tap click delay is already off. It was a good
fit for a 300-versus-500 threshold, which is exactly why it was worth disproving rather than
assuming.

## Why no third fix

Two fixes have shipped on plausible mechanisms and both failed on the device. A third guess costs
another device sitting and keeps `BF-94` blocked behind it.

**And the harness structurally cannot see what is left.** `page.touchscreen.tap()` is a CDP
dispatch straight into the renderer; a real Android tap travels through the compositor's hit test
first. A green run here is evidence about the JS path and nothing below it.

## What was handed to Device Verification instead

`BF-61` is re-laned `B` → `DV` — the next action is a measurement nobody has taken with an
objective result, which is what that lane is for. The fix stays Lane B's and comes straight back.

The probe asks three things in order, each of which halves what is left: whether
`document.elementFromPoint` at Delete's centre returns the button or the row during the window;
whether a `pointerdown`/`touchstart` listener on the button fires at all; and whether a `click`
follows if it does. Hit-testing, a press that never reached the renderer, and a suppressed click
need completely different fixes, so the entry says not to touch it again until one is named.

## Also recorded, because a cloud session cannot message another session

Two notes were written onto `DV-12` rather than sent: a correction to this lane's own #1675 claim
(a real per-canvas measurement of 578 → 0 was generalised into a claim about the whole tab switch,
and sweep 4a was right to still find 16 of 20 taps at 51–104 ms), and the one question that decides
`OR-162`'s remaining half — whether the harness can separate "on arrival" from "while hidden" for a
single canvas, with Wear Time as the control.

## Failure surfaces not exercised

The device, which is the whole of what is left here. Nothing in this diff changes product
behaviour: it adds one e2e test and rewrites two backlog entries.

<a id="2026-09-26-branch-hygiene-settings"></a>

# 1,562 branches → 45, and the two repository settings that were wrong

**Owner-driven, 2026-09-26.** He asked *"we have 1500 branches — why do we have so many open. Do we
need a setting that closes them as they merge"*. Yes, and it was one unticked checkbox.

## What was measured

| | |
|---|---|
| Remote branches | **1,562** |
| Open PRs | 7 |
| Closed but **never merged** | 28 |
| Merged PRs (1,534 unique head names) | 1,640 |

The repo is six weeks old, so 1,562 branches is ~37/day — exactly the merge rate with nothing
cleaning up. **"Automatically delete head branches" was off.** The proof was immediate rather than
inferred: branches from PRs merged twenty minutes earlier were still present.

## Two claims in CLAUDE.md were false, and both are corrected here

**It asserted auto-delete was ON**, and built the stale-local-refs ritual on that premise. It was off
for the repository's entire history.

**It asserted `enable_pr_auto_merge` does NOT work here**, citing *"Protected branch rules not
configured for this branch"*. That is the `ProtectMain`-was-`Disabled` signature again — the same
root cause as OR-164, now Active. **Allow auto-merge is enabled**, and the line is marked stale
rather than flipped, because **it has not been tested**. Third time today a passage has been wrong in
both directions; asserting the opposite without measuring is what produced the first two.

## The trap worth keeping

**`git branch --merged` reported 3 merged out of 1,562.** Not because they were unmerged — because
squash-merge writes a brand-new commit, so a merged branch's tip is *never* an ancestor of `main`.

This matters more than the cleanup. A naive "delete merged branches" script deletes nothing. A script
"fixed" by ignoring ancestry deletes the **28 closed-but-unmerged** branches, which are precisely the
ones holding work that never landed (CLAUDE.md names four: #1426, #1428, #1430, #1435, *"all
abandoned with sound diffs"*). Any branch cleanup must key on **PR state**, not git ancestry.

## What ran

Ruleset checked first, deliberately: `ProtectMain` enforces a `deletion` rule, and had it targeted
all branches rather than `main`, both auto-delete *and* the manual cleanup would have failed
silently. It targets `main` only — confirmed on screen before anything else was touched.

Then: intersect merged-PR head names with what is actually on the remote, subtract open PRs and
`main`. 1,516 branches deleted in batches of 50.

**Result: 1,562 → 45**, matching the prediction exactly — 1 `main` + 7 open + 28 closed-unmerged +
~9 that never had a PR at all. Those nine were correctly excluded: a branch with no PR is the one
category where the script cannot tell shipped work from unshipped.

## Not done by the agent, and why

**The sandbox cannot delete remote refs.** Two attempts returned a bare `HTTP 403` with no `remote:`
message — the session's git credential is push-scoped. A ruleset rejection would have arrived as
`GH013: Repository rule violations found`, which is how the two were told apart before blaming the
wrong one. The owner ran every deletion from his own machine.

**Auto-merge is untested.** Enabling the checkbox is not evidence it works.

<a id="2026-09-26-branch-meaning-rule"></a>

# Every branch has a reason, or it goes — and the four that nearly went by mistake

**Owner, 2026-09-26:** *"make sure all the open branches are open for a reason - ideally we want
every branch to have meaning."* This is the rule that answers it, and the audit that found the
exception which makes the rule safe.

## The rule

**A branch has meaning only if it has an open PR.** Auto-delete now clears merged branches, so
anything left is a branch whose PR closed unmerged or one that never had a PR. **Work worth keeping
gets a draft PR** — that is the marker, it costs nothing, and it puts everything in one list.

## Why not the `Branch:` field, which was the obvious answer

The backlog already has one, on **199 entries**. It was rejected on measurement: it records a
**plan**, not a fact, and it is already wrong. `Q-44`'s entry names `refactor/de-oura-identifiers`
while its live branch is `lane-a/q44-phase3-pr1-table-rename`. `OR-127` and `RV-99` have live
branches and no field at all.

A draft PR is a fact GitHub maintains and cannot drift. A prose field is one more thing to keep in
sync, and it demonstrably is not.

## The audit, and the part that matters

48 branches. 9 open PRs + `main` have a reason. That leaves **38**.

**Four hold unmerged work for entries STILL IN THE QUEUE:**

| branch | entry | size |
|---|---|---|
| `chore/or-127-device-cdp-harness` | **OR-127 — rank 1 in `DV`** | 12 files, 7 commits |
| `lane-a/q44-phase3-pr1-table-rename` | Q-44 | 13 files, 4 commits |
| `lane-a/rv99-score-band-theme-tokens` | RV-99 | 14 files, 4 commits |
| `lane-a/fix-gate-pin-q305` | Q-305 | 1 file, 1 commit |

**This is the finding.** "No open PR → delete" is the rule anyone would write, and it would have
discarded a head start on the top-priority device item. Filed as `OR-174` with a recommendation to
open draft PRs for all four.

**Two are provably dead** — 0 commits ahead, 0 files differing from `main`:
`claude/implementation-agent-lane-a-ztkb3m` and `lane-a/tn46-baseline-already-retained`. Note TN-46
is *still queued* while its branch is empty, so a branch matching a live entry is not automatically
worth keeping. **Check the diff, not the name** — that cuts both ways.

**The remaining 32 are sweepable**, and none had a merged PR, because the earlier cleanup would have
taken it.

**Two violate the naming rule outright** — `claude/implementation-agent-b-s1m4qs` and
`claude/implementation-agent-lane-a-ztkb3m` are exactly the auto-generated shape CLAUDE.md forbids.
The rule did not stop whatever produced them, which is worth a thought on its own.

## One method note worth more than the snapshot

A diff against `main` does **not** prove work is unlanded — three-dot diff measures from the
merge-base, so squash-merged work still shows. What proves it here is that the earlier cleanup
deleted every branch with a merged PR, so by construction each survivor is closed-unmerged or
never-PR'd. And `git branch --merged` remains useless: 3 of 1,562.

## Also in this PR

**The vitest teardown flake, ninth sighting** — a fifth distinct file
(`nutrition-goals-recommend-route.test.ts`), on a docs-only PR, `2498 passed / 1 error`. Re-ran
clean, **nine for nine**.

Two things the existing write-up predates. **`Tests` became a required check on 2026-09-25**, so
this now *blocks the merge button* rather than costing a re-run — which is why it is finally filed
(`LA-146`) after nine sightings and zero entries. And **the re-run no longer has to be a push**:
`rerun_failed_jobs` re-runs only the failed job and leaves E2E alone, where the doc still describes
a re-run as restarting a 34-minute job.

## Not done

**Nothing was deleted.** The sandbox credential cannot delete remote refs (bare `HTTP 403`, no
`remote:` line — a ruleset rejection would say `GH013`), and the four live-work branches need the
owner's call first.

**Auto-merge was untested; it is now tested and it WORKS.** The first attempt, on #1679, returned
*"already in clean status … auto-merge only applies when checks are pending"* — the **tool**
declining, not GitHub refusing, and a different error from the `"Protected branch rules not
configured"` the stale claim rested on. So it proved nothing either way. Re-attempted on **this PR
while its checks were pending: enabled first try.** CLAUDE.md now says it works, with the gotcha
that it must be enabled *before* the PR goes green.

<a id="2026-09-26-bugfix-bf-204-collection-pen-crowding"></a>

# 2026-09-26 — the collection pen is crowded by construction, not by chance (BF-204)

The owner used the cat collection for the first time on the S25 and reported it plainly: *"Its a bit
cramped in there. Might be too many at once."* Intake traced it and filed **BF-204** (Lane B, rank 1).

## The report was right about the symptom and understated the cause

"Too many at once" reads as a cap that wants lowering. Lowering `MAX_SHOWN` alone would not fix it,
because three mechanisms each force crowding and they compound:

1. **`penCats` sorts biggest-tier-first and then takes the top twelve**, so the pen always draws its
   twelve *largest* cats. It never shows a 34 px slime while a 50 px Tank exists. Twelve T2s is
   **600 px of sprite in a 348 px pen — 1.72×**.
2. **One tier means one vertical band.** Tier 2's band is `[32, 44]` — a 12 px spread — so the set
   mechanism ① selects lands on a single line. The depth-by-tier design cannot separate cats that
   are all the same depth.
3. **Slots are narrower than sprites**: `348 / 12 = 29 px` against 34–50 px, so neighbours overlap
   by ~13 px before any wander, and the wander is ±4 slots.

## The pen is 176 px tall and v1 can reach 44 px of it

`SIZE` and `BAND` carry six entries and `FLYING_FROM_TIER = 4`, but every v1 ladder has three tiers.
Bands 3–5 and the flying mechanic are unreachable, so **17 % of the pen's height is in use and ~75 %
is empty sky** — the exact shape of the screenshot. The room to spread cats out was allocated and
cannot be reached until PS-49's six tiers land.

That is also why the entry says **not** to stretch the bands now: v2 spends that sky.

## The name tags are the loudest symptom

Twelve six-character tags ≈ 456 px against 348 px. On the owner's screenshot "Beaso" is occluded and
"Har", "P" and "Xecom" are clipped mid-word.

## Measured, not assumed

Production, 2026-09-26: 106 workout days, 149 step days, 106 sleep days. Replayed against the v1
costs that is ≈ 22 cats with ≈ 13 at top tier — so mechanism ① draws twelve 50 px sprites. His card
reads 12 shown + "+12 more" = 24, consistent to within the decay events the estimate does not model.

## One correction worth recording

An earlier reply in this session described the collection as shipping emoji glyphs with the artwork
still outstanding. That was read off a clone 38 commits behind `main`; the art, the names, the pen
and the scenes had all shipped. Re-sync before describing a feature's state.

## Not exercised

Docs-only. Nothing was run against the device, and the pass/fail BF-204 names — no clipped name, no
fully hidden cat — is owed on the S25, not in the sandbox.

<a id="2026-09-26-bugfix-bf-205-home-reorder-fab-info"></a>

# 2026-09-26 — three from one Home screenshot: a button that does nothing, a button nothing makes room for, and a wall of grey text (BF-205 / BF-206 / BF-207)

The owner's second pass over Home after trying the cat collection produced three separate reports.
Each traced to a different cause, so each got its own entry.

## BF-205 — "Reorder sections" cannot reorder

Not a broken drag. **There is no drag.** `HomeSortableSection` is named *Sortable*, takes an `id`,
and is thirty lines holding one hide button — no `useSortable`, no `DndContext`, no pointer handler.
`@dnd-kit` is a dependency and `components/config/sortable-row.tsx` uses it; the Home surface never
imports it.

Everything around the gesture exists, which is why it reads as broken rather than missing: the
header button, `aria-pressed`, the persisted `sectionOrder`, and a `sectionOrderRef` whose comment
says *"so drag/sync handlers can read it synchronously"*. Only the `/sync` half was written.

Settled by enumeration rather than by reading around it: `setSectionOrder` has four call sites — the
initial state, two loads from storage, and the reconciliation that runs when a widget is toggled in
More. No code path anywhere turns user input into a new order.

## BF-206 — the Coach button, two problems in one control

**The reserved space is one control short.** Home's scroll container uses `pb-nav-safe`
(`3.5rem + inset + 0.75rem`) — the nav bar only. The FAB is `bottom-fab-safe` and `h-14`, so its top
edge is **56 px above the reserved padding**, and the bottom 56 px of the scroll on the right can
never clear it. On the screenshot that is the day-timeline's workout row.

**Nothing identifies it.** A sparkle in a filled circle, named only by `aria-label`. The sparkle is
the app's generic AI mark — it also appears on the weekly-recap banner, the meal-source row and the
profile tab — so it names a category, not a destination.

**One suspicion checked and dropped:** the stark white circle looked like a contrast outlier.
`bg-foreground text-background` is the repo's standard filled-control treatment across segmented
tabs, coach messages, macro targets, the goal toggles and the calendar's today cell. Consistent, so
not the thing to change. Checking it first is what kept it out of the entry.

## BF-207 — the explanation is the wrong shape, not the wrong words

`Rules()` is four paragraphs, **177 words**, all at 12 px in `text-muted-foreground`. The prose is
good and interpolates every number from the engine's constants, so it cannot drift from the fold —
a property worth keeping through any redesign. What it explains is four pictures: three small cats
becoming one big one says the merge rule without words.

Filed `Lane: O` because it is a judgement about looks, with a recommendation attached and the
sequencing noted — PS-49 changes every number on that page, so the redesign belongs after it.

## Not exercised

Docs-only; nothing ran. BF-205 and BF-206 both owe a device check, and BF-206's needs **both**
navigation modes: a three-button nav reports every safe-area inset as `0`, which makes a broken
clearance look correct.

<a id="2026-09-26-bugfix-bf-208-collection-screen-ui"></a>

# 2026-09-26 — the white circle was the moon, and BF-206 was filed against the wrong button (BF-208 / BF-209, correcting BF-206)

The owner pointed at a white circle on the Home collection card. I traced it to the AI Coach
floating button and filed `BF-206` against that. He corrected it: *"No not the ai coach white
button; its the one on the collection widget."*

## What it actually is

`public/cats/scene-meadow.svg`, line one of the sky:

```
<circle cx="300" cy="36" r="14" fill="#f3ecd2"/>
```

**The moon.** A 28 px solid near-white disc on a `#16203a → #2a3a5c` sky, rendering almost 1:1 into
the ~348 px pen, in the upper-right corner. Decoration drawn as a control: highest contrast in the
card, hard-edged circle, corner position.

**The worse half is 30 px to its left.** `+12 more` is styled `rounded-full bg-background/70 px-1.5`
— a pill — and is a plain `<span>` inside an `aria-hidden` div. It reads as "tap to see the other
twelve" and does nothing. The card's own link does eventually show them, by accident. So the corner
holds two button-shaped things and neither is a button.

## The correction to BF-206

Finding ① — Home reserves nav height but not the 56 px FAB above it — was measured from the CSS, so
it stands on its own and the entry keeps it.

**Finding ② was struck.** "Nothing identifies this button" was an unreported design opinion that
existed only because the misread made it look like the owner's complaint. Intake does not file
restyles of working controls that nobody mentioned. The entry now says so in place rather than
quietly dropping it.

The lesson, and it is the second time this session: a report that names a thing vaguely ("that
button", "the white circle") needs the *thing* identified before the trace starts. I had two white
circles on one screenshot and picked the one I had already found.

## BF-209 — the rest of the screen

He also sent `/collection` and said both screens were not good. Measured at 412 dp:

- The tier row is `justify-around` with three 48 px sprites in a 348 px card — **144 px of content,
  204 px of gap, 59 % blank**.
- Nothing in that row says the three tiers turn into each other. No arrow, no cost, on a screen
  whose whole subject is merging.
- `SHOWN = 20` per ladder: **~1,770 px today (2.2 viewports), ~3,000 px at the cap (3.7)**.
- The roster's second line names cats that no longer exist — `settle()` does
  `held[i].splice(0, cost)`, so "from Beanger, Wag, Junky +1" is four names with no referent.

**One suspicion checked and dropped:** the 10 px type looked like the problem. `text-[10px]` appears
**586 times** across the app — it is the house caption size, not an outlier. The density complaint
stands on row count, not type size.

Filed `Lane: O` beside `BF-207`, with a note to answer both together: one screenshot, one screen,
and splitting it would redesign the page twice.

## Not exercised

Docs-only; nothing ran. BF-208 owes a device look at the real width in dark theme.

<a id="2026-09-26-design-collection-catalog"></a>

# The cat collection's design set is complete: 7 classes, 4 coats, 12 scenes

**Branch:** `design/collection-catalog` · **2026-09-26** · **v1.469.0**
**Follows:** [`2026-09-26-feat-collection-cat-names.md`](entries/2026-09-26-feat-collection-cat-names.md) (#1710)
**Filed:** PS-53 (design review, Lane O, with a Tuning part) · **Catalogue:**
[`cat-collection-design-catalog.md`](../domains/app-shell/cat-collection-design-catalog.md)

## The owner's close-out brief

*"We are just creating the designs here for now"*: enough backgrounds to assign to trophies, all the
cat sprites, animated and named, and a cat for every category worth tracking, including extras (*"we
dont need to use them all as long as they exist"*). Then merge, document, and hand review to the
Orchestrator or Tuning.

## What was added

- **Three classes**, so every trackable category has a cat: **Mage** (sleep), **Alchemist**
  (nutrition), **Monk** (mood & recovery), each with six tiers of gear. That makes seven with Tank,
  Ranger, Rogue and the Health cat.
- **Two skins, frost and ember**, for every class and tier, alongside the shiny. That is 168
  sprites in all.
- **Eight scenes**: gym, park, bedroom, kitchen, beach, snowfield, space, cherry blossom. That makes
  twelve, each with a proposed trophy in the catalogue.
- **An ear flick** added to the in-SVG animation (tail, paws, blink, bob). Every loop was checked
  frame by frame by freezing a sprite at eight points in its cycle.
- **The sleep ladder now draws the Mage.** It counts nights of sleep, and the Health cat is for
  logging, which PS-49 will build.
- **`scripts/collection-art/preview.mjs`**: an animated gallery of everything, written to the temp
  directory, for reviewers.
- `classArt(cls, tier, variant)` and `CAT_CLASSES`/`CAT_VARIANTS` in `collection-sprites.ts`. The
  drift test now covers all 180 generated files and checks that every class × tier × variant
  exists.

## Not exercised

The S25 (BF-126 `Verify: owner` covers it). Most of the new assets are not yet reachable in the app
by design: they are catalogued, not awarded.

## Gates

`pnpm check:rules`: see the PR. Collection tests pass. eslint and `tsc --noEmit` are clean.

<a id="2026-09-26-device-sweep-4-plan"></a>

# 2026-09-26 — Device sweep 4 plan, from a review of the DV lane

**Branch:** `device/sweep-4-plan` · **Agent:** Device Verification · **Docs only.**

Reviewed all 33 `Lane: DV` entries and the 116 device checks owed elsewhere. Every sweep-2/3 finding
filed on another lane has since shipped a fix (DV-15, DV-16, DV-17, DV-18, BF-61, BF-177, RV-103,
RV-111), so those are station A. `docs/device-sweep-4-plan.md` splits the work into two sittings:
- **4a** (~2 h 30 min, nothing needed from the owner): fix checks, the post-fix performance
  readings, and new probes.
- **4b** (~2 h 30 min): the gesture-navigation checks, the RV-155 debt stations, and the RV-125/BF-22
  re-runs.

Five owner decisions are listed first, including updating the phone's APK from 1.460.4 to 1.465.52
and holding TN-62 until BF-13 can run. Housekeeping for the Orchestrator:
- DV-14's pass test is now met.
- BF-12 is answered.
- BF-147's device half has passed.
- Q-525 duplicates TN-1.
- LA-56 and RV-169 are not device work.

<a id="2026-09-26-device-sweep-4b"></a>

# 2026-09-26 — Device sweep 4b: gesture-nav checks pass, food-delete tombstones stick at `pending`

**Branch:** `device/sweep-4b` · **Agent:** Device Verification · **Docs only.**

S25, APK 1.465.52, web v1.465.67, gesture navigation. Production was watched throughout with no slow
answer.
- **Closed:** DV-2, BF-165, RV-37, RV-127 (clearance half) and RV-125 (write-half re-run, attributed).
- **New:** DV-8 is common, not a one-off — 36 food delete tombstones are stuck `pending` with both
  outboxes empty. RV-155 station A found no `health-alerts` notification channel.
- **Updated:** RV-205's private gallery (version 3, 75 captures, P25 passes). RV-206 read-only probes:
  P39 formatting mix, P33 reach, P34 input modes, P32, and P40 passes. BF-22 is narrowed further (no
  growth through writes and sheets). PS-35b's launch half passes.
- **Not run:** RV-206's P29–P31 (these need the owner's OK), RV-155 station C and most of B/D/E, and
  P35–P38.

<a id="2026-09-26-docs-bf-198-full-override-session-deload"></a>

# 2026-09-26 — BF-198: `Full` cannot override a whole-session deload

Owner, on a Saturday Upper showing *"AI Prescription · Deload"* with `Full` selected:
*"How am I supposed to select a full workout when the prescription is deload?"*

**He cannot, and the card is right to say so.** `Full` works by reverting each exercise to the
`preDeload` block the prescription recorded. The whole-session deload builder stamps `deloaded: true`
on every exercise and **never writes that block**, so there is nothing to revert to and the toggle is
inert by construction.

Both shapes are live in his own data (`session_periodization`, six most-recent):

| session | `deload` | deloaded | with `preDeload` | `Full` works? |
|---|---|---|---|---|
| **Upper (screenshot)** | true | **5 of 5** | **0** | **no** |
| Pull | true | 5 of 5 | 0 | **no** |
| Lower (earlier) | true | 1 of 5 | **1** | yes |

A whole-session deload always produces the dead toggle; a per-exercise one never does; and nothing on
screen distinguishes them before he presses it.

**The remedy the card names does not exist.** It says *"you would need a new prescription for that"* —
but `PrescribeBodySchema` is `.strict()` and takes only `excludeSessionId` and `durationPreset`.
Intensity is not an input on that route, so regenerating re-derives the same deload. The card is
honest about the first fact and wrong about the second.

**The cost that is worse than the dead toggle:** loading the bar heavier anyway does not help, because
`ex.deloaded` stays true on all five, and the PR gate requires `!ex.deloaded`. A genuinely full session
would be recorded as a deload and earn no 1RM credit, invisibly.

**Recommended fix:** have the session-level builder record `preDeload` as the per-exercise path already
does — four fields it is holding at that moment, no route or schema change, no LLM call, works offline.
Filed `Lane: A`.

Left undiagnosed and flagged: `deloadReason` is NULL on all six stored prescriptions, so nothing can
say *why* the session was deloaded — worth its own look, since an unexplained deload is the one a
lifter overrides.
