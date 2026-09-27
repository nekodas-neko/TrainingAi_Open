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
**Follows:** [`2026-09-26-feat-collection-cat-names.md`](#2026-09-26-feat-collection-cat-names) (#1710)
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

<a id="2026-09-26-docs-bf-199-prescription-without-ai"></a>

# 2026-09-26 — BF-199: does the prescription need AI?

Owner: *"Prescription uses ai right? Do we NEED ai for this? Can we do this through logic so its easy
to prescribe and represcribe"*

**No, and most of it already is logic.** There is exactly one model call in the pipeline
(`generateObject`, `generate-prescription.ts:304`). Everything around it — reconciliation, role
plausibility, the budget fitter — is deterministic, and **the deload path produces a complete
prescription with no model call at all**. The app already ships a working non-AI prescriber.

What the model actually contributes, measured across all 33 distinct `(sets, reps, pct, rest)` tuples
in `session_periodization`:

| output | production | whose number |
|---|---|---|
| **sets** | **2 in all 33 tuples** | not the model's — `fitToBudget` clamps to its floor because the budget is binding (BF-197) |
| **reps + pct** | 12→66, 11→68, 10→70.5, 9→72.5, 8→75, 7→76–77.5, 6→80 (~+2.25 %/rep) | a lookup table; `style_sets` already stores these same fields |
| **rest** | **23 values from 68 s to 300 s** (76, 97, 143, 189…) | the model's, and the only free one — the styles say 60/90/120/130/180 |

The one quantity it controls end to end is the one that looks wrong.

**The counter-argument, not overstated:** reliability is not a problem today — `ai_call_log` shows
**35 prescription calls, 35 ok**, 2.1 s and 3,645 tokens average. The route has no fallback, so a
failure means a 502 and no plan, but that has not bitten. The case rests on what the model adds.

**Recommended:** numbers from deterministic rules, prose from the model. That makes representcribing
instant, offline and free; it dissolves BF-198 (a full prescription becomes a pure function of the
same inputs rather than stored state the deload never recorded); and it makes sizing changes
replayable over history, which is the evidence BF-189 needs and cannot get from a non-deterministic
generator.

**One part is explicitly not a lane's to decide:** the rep→%1RM table values are the loads he trains
at, so they are calibration — Tuning proposes, the owner signs.

Left undiagnosed: how often the model's *phase* decision survives reconciliation, as opposed to the
four per-exercise numbers. That belongs in the plan doc, since a phase engine is the part that might
genuinely want judgement.

<a id="2026-09-26-docs-bf-200-deload-skips-one-exercise"></a>

# 2026-09-26 — BF-200: the deload applied to four exercises and not the fifth

Owner, mid-deload: *"I went through with the deload routine. But it seems like skull crusher weight is
the same as my active workout. Why's that?"*

He is right, and it is one exercise out of five. Measured against the stored Upper prescription (all
five at `pct: 52`, `deloaded: true`):

| exercise | last real 1RM | 52% | loadable | app showed | |
|---|---|---|---|---|---|
| Incline Bench Press | 56.25 | 29.25 | 30 | **30** | ✅ |
| Chest-Supported DB Row | 15.5 | 8.06 | 8.75 | **8.75** | ✅ |
| Dumbbell Lateral Raise | 11.25 | 5.85 | 6.25 | **6.25** | ✅ |
| **Barbell Skull Crusher** | **36.5** | **18.98** | **20** | **30** | ❌ |

30 kg is his ordinary working weight — 2026-09-20 was 30×8 ×3. The deload machinery itself is fine.

**Two mechanisms both produce exactly 30 and the arithmetic cannot separate them:** the pct applied to
the all-time PR of **57.75** (52% = 30.03, exact), or the pct not applied at all and the normal
`target_80` of 29.25 snapping to a loadable 30.

**The check that settles it already exists.** `resolveWorkingBasisWithSource` returns
`source: 'last_real' | 'seed' | 'pr'` for exactly this question — `pr` proves the first, `last_real`
the second.

Under the first, the interesting part is *why* a usable 36.5 did not reach the resolver: deload rows
store `estimated_1rm = 0`, so a query filtering on that column returns nothing for an exercise whose
recent history is deload-heavy, and the fall back to a months-old PR is silent.

Flagged but not established: the 57.75 PR looks inflated against a 36.5 current, and CLAUDE.md already
records an inflated-PR class. A wrong basis and an inflated basis compound — either alone would have
been obvious; together they produce a number that looks plausible.

Not checked: `Pull` is also a whole-session deload and was not examined exercise-by-exercise.

<a id="2026-09-26-docs-bf-201-202-route-owner-decisions"></a>

# 2026-09-26 — BF-201 / BF-202: routing owner decisions out of implementer entries

Owner: *"any tasks that need responses make sure they are in the lane of orchestrator or sent to the
backlog agents."*

Audited this session's twelve entries. One genuine gap: **two decisions about the loads he actually
trains at were sitting inside `Lane: A` entries**, where the routing field cannot see them —

- **BF-197** — how much finish-early margin to keep once the 14.2-minute double-count is removed
- **BF-199** — the rep→%1RM table that would replace the model's numbers

Both are scoring calibration, the one category the structural-questions narrowing keeps with the
owner. Split into **BF-201** (`Lane: O`, with an `Ask:` field, ungated) carrying a recommendation,
alternatives and reversal cost for each. **Deliberately no `Needs:`** — BF-197's off-by-one is a
correctness bug that should ship without waiting, and BF-199 wants a plan doc first, so neither lane
is blocked on the answer. Both parents now point at BF-201.

Verified BF-201 and BF-191 both appear under WAITING ON THE OWNER.

**The pattern is wider.** Scanning the whole queue for owner-decision language in a `Lane: A`/`B`
entry with no `Ask:` field returns **70 entries** — filed as **BF-202** for the Orchestrator, whose
stated primary job this is. The number is an upper bound: the scan is a keyword match and cannot tell
*"the owner decided X"* from *"the owner must decide X"*, and separating those is the actual work.
`LA-122` already tracks six of them, so the sweep should reconcile rather than duplicate.

Flagged without acting: **RV-65** is Review's earlier statement of what BF-199 measured, and
RV-200/RV-202 from sweep 61 cover adjacent ground — four entries now describe the same AI-to-logic
change from four angles. Merging them is a queue decision, so BF-202 hands it to the sweep rather
than folding another agent's entry into ours.

<a id="2026-09-26-docs-meal-plan-tracking-spec"></a>

# 2026-09-26 — BF-203: meal-plan tracking, designed

Owner: *"There is a meal plan tracking feature i wanna explain and have it added."* — a plan derived
from his real numbers, estimated meals when a window passes unanswered, and the next weigh-in used to
correct what those estimates really were.

**Measuring before designing cut the scope hard.** Most of it already ships: goal-derived targets,
meal windows (`meal_types.timeStartHour/timeEndHour`), reminders with a skip action, per-slot target
macros, **`plan_meal_answers`** already tracking whether a planned meal was eaten, adherence, and
carbs already skewed around training in `meal-split.ts`. The request reduced to three additions — an
`estimated` answer state, a resolve surface, and a rolling corrector.

**The corrector is a fortnight, not a next-day adjustment, and that came from his data rather than
caution.** A 500 kcal meal is 65 g of tissue; his median daily weight swing is 200 g. He reframed it
directionally — *"they weighed higher, they likely ate more"* — which tested at r = +0.175 and 57%
direction agreement over 61 day-pairs. The sign is right; applied daily the correction would be wrong
4 times in 10. Over a fortnight the same edge is reliable, so the design is his mechanism at the
resolution where it beats the noise.

**His second question improved it.** Asking whether scale body-fat would isolate fat change tested
better: fat mass is 28% quieter and correlates at +0.217. Not a clean separation — impedance tracks
hydration, and his body fat % carries a 2.26 pp daily sd — so fat mass is primary, weight is the
agreement check, the estimator is median/trimmed, and disagreement days are dropped.

**Architecture:** the estimate is an answer against the plan meal, never a `food_logs` row, so
invented calories physically cannot reach the maintenance estimator or adaptive TDEE. The rejected
alternative is recorded with what it was better at — `BF-137` and `BF-138` are live energy-model
defects, and leaving correctness to every consumer remembering a filter is how both happened.

Spec: `docs/superpowers/specs/2026-09-26-meal-plan-tracking-design.md`. Calibration constants are
flagged as the owner's, not an implementer's, and the build is not blocked on them.

## The plan, and two corrections the code made to the spec

Phase A's plan is written: `docs/superpowers/plans/2026-09-26-meal-plan-tracking-a-estimated-answers.md`
— ten TDD tasks, the migration shipping as its own PR per the no-batching rule. BF-203 became a spec
pointer with BF-203a/b/c beneath it, the way BF-11 and Q-395 were split.

**Reading the code corrected the spec twice.** The schema comment on `plan_meal_answers` (Q-187 phase
2) states the table's actual rule — *only declines live here* — which resolved an ambiguity the spec
had flagged (the `'no'` default never materialises on its own) and **invalidated the resolve flow the
spec described**: storing `'yes'` would be *"two sources of truth for one fact"*, since "I ate it" is
derivable from the food log. So confirming an estimate writes the log and clears the estimate, and
the feature adds exactly **one** new state rather than several.

That comment also reached this design's conclusion independently, before the feature existed: keeping
unconfirmed prefills out of `food_logs` is *"what stops the day's totals counting food nobody ate,
without teaching 23 readers a new filter."*

**Plans for B and C are deliberately not written yet.** They depend on the shape A actually lands, and
writing them now would be guessing at interfaces that do not exist — the same reasoning as the
protocol's "re-verify the plan against current `main`", applied forwards.

**Two checks caught real defects during the write-up.** The plan's own self-review found three helper
functions called in Task 8 and defined nowhere (now Task 5b). And `check-backlog-pointers` rejected
`Needs:` written inline on the `Added:` bullet — where it is silently ignored — which would have left
BF-203b and BF-203c printing as READY and let someone start the corrector before the migration
existed.

<a id="2026-09-26-dv21-notification-channels"></a>

# Two notification channels the app posted to and never created

Implementation Lane B, 2026-09-26. `DV-21`, from Device Verification sweep 4b station A.

## What shipped

`components/capacitor-native-init.tsx` creates two more channels:

- **`health-alerts`**, importance 4 (heads-up), vibrating.
- **`workout-reminders`**, importance 3, silent — matching the other reminders.

and `components/__tests__/dv21-notification-channels-exist.test.ts` fails if any `channelId:` in
`app/`, `components/`, `lib/` or `packages/` names a channel no `createChannel` call creates.

## Why it could not be seen from inside

On Android 8+ a notification posted to a channel that does not exist is **dropped by the system,
silently**. Above the channel everything looked healthy: `computeHealthAlertActions` is unit-tested
and passes, `reconcileHealthAlerts` runs from `sync-provider.tsx` on every sync, the dedup key is
written. The only surface that shows the fault is the device's own channel list, which is where
sweep 4b found it — the S25 had exactly one app channel, `oura-ble-v2`.

So illness, high-stress and low-readiness alerts (ids 9300/9301/9302) have never been able to fire.

## The guard found a second one, which is the reason it exists

The scan was written for the fix it came with, and it immediately failed on **`workout-reminders`**.
`reconcileWorkoutReminder` runs from the same `sync-provider.tsx` and has been scheduling to a
channel nothing creates for as long as health alerts have. Nobody had reported it and no sweep had
reached it. That is the sibling-surface sweep CLAUDE.md asks for, done by a scan rather than by
waiting for a second sighting — and it is the argument for the scan over a one-line fix.

## The importance was chosen deliberately, because it cannot be changed later

**An Android channel's importance is immutable once created** — the Kotlin services carry `-v2` ids
for exactly this reason (`OuraRingService.kt:48`, `ScaleBleService.kt:57`). Raising it afterwards
needs a new channel id and a delete of the old one on every installed device.

Health alerts take **4**: they are things to know before the day starts, they fire at most once per
type per day, and a silent tray entry missed for a day is worth nothing. Workout reminders take
**3** like the meal, supplement and day-review reminders — it is a time the owner asked for, not an
anomaly.

## Not established, and unchanged by this

Whether any health alert has ever been *attempted*. A dropped post leaves nothing behind, so the
absence of alerts is equally consistent with the conditions never triggering. The device check owed
on `DV-21` forces one rather than waiting for a real anomaly.

## Failure surfaces not exercised

Everything that matters here is the device's: the channel list, the post, and the tap routing to
`/health/readiness`. Nothing in the sandbox runs `LocalNotifications` — the Capacitor branch is
inert on web, so `pnpm dev` and the Playwright shell pass prove only that the module still imports
and the five tabs still paint. **No APK is needed**: this is TypeScript in the WebView, so a
Railway deploy reaches it.

## Verification run here

`pnpm lint` 0 errors / 828 warnings (identical to the base) · `pnpm check:rules` Ran 80 of 80 ·
`pnpm test` 1089 files, 10184 passed · `pnpm build` clean · `tsc --noEmit` clean ·
`check-test-typecheck` none above baseline · `e2e/tabs-instant-paint.spec.ts` 7 passed, which is
the dev-server pass. Control run: deleting the `health-alerts` channel again fails the guard.

<a id="2026-09-26-dv8-confirm-before-clearing-the-outbox"></a>

# 2026-09-26 — DV-8: the outbox was cleared before the rows were confirmed

**Branch:** `fix/dv8-strand-on-confirm-throw` · **Lane A** · one cause found and fixed; the heal and
the `set_logs` row are still owed

## The signature

Device Verification measured it precisely across two sweeps: local rows sitting at
`sync_status='pending'` while **both `mutations_outbox` and `sync_outbox` are empty** and the
server has already applied the write. Sweep 4b found **36** `food_logs` rows in that state — every
one a delete tombstone, spread over 14 days — plus the original `set_logs` row pending since
2026-09-19. Other domains clean.

That combination is the whole clue. An empty outbox means the mutation was consumed; `pending`
means the local row was never confirmed. Nothing retries a mutation that is no longer queued, and
`applyDelta` only overwrites `synced` rows, so the row cannot be corrected by any later pull.

## The cause was not a missing arm

The obvious reading — a domain whose delete has no confirm arm — is what DV-5 already fixed, and
the food delete arm is present and correct: `markFoodLogSynced` is a keyed `UPDATE` with no
`deleted_at` filter, so the row it needs is never filtered away.

`pushMutations` deleted the **whole batch's** outbox entries and *then* ran a hundred-line
per-domain mark-synced loop with **no error handling anywhere in it**. Any arm throwing on a local
read or write aborted the loop, leaving every row after it `pending` with its outbox entry already
gone.

**Proven, not inferred.** A test makes one arm throw and asserts the sibling is still confirmed and
the throwing row keeps its outbox entry. Against the old order it fails — the error escapes
`pushMutations` entirely and the sibling is never marked.

## The fix

Confirm first, per row, guarded; clear the outbox only for rows that actually confirmed. This is
the rule the Oura history cursor already follows and states outright: only advance past what is
durably recorded. A re-push is free because every domain's handler is idempotent; a lost
confirmation is not.

A confirm failure is deliberately **not** recorded as a mutation failure. The server applied the
write, so counting it toward the dead-letter budget would present a success as a failure. The entry
stays queued and the next push retries it. The cost — a permanently-throwing arm retries forever —
is stated in the code and is strictly better than the silent permanent strand it replaces.

## Mutation pass

4 deliberate defects, all killed; 1 deliberately equivalent control, survived.

One survived the first round: swallowing the confirm error silently. That was a real gap rather
than a nitpick — this path does not dead-letter, so the log is the only way a repeating confirm
failure is ever noticed, and silence is exactly what let 36 rows accumulate over 14 days unseen.
The test now asserts it.

## What this does NOT explain, and I nearly claimed it did

The entry also carries a `set_logs` row pending since 2026-09-19, and my first draft of this note
used it as evidence — *"the same strand hit a different domain, so it cannot be a food-specific
arm"*. A merge conflict with the device agent's own update to DV-8 is what caught it: their side
records a separate, better-evidenced hypothesis for that row. `workout_log`'s confirm arm is
`markWorkoutSynced(wsId, exerciseLogId)`, a keyed `UPDATE` that reads nothing back, and the row's
`exercise_logs.workout_session_id` does not resolve to a local `workout_sessions` row. An orphaned
id is not something a confirm-ordering bug produces.

So: two causes, one symptom. The ordering fix closes the tombstone class and leaves that row open,
and the entry now says so in both directions. Keeping both sides of that conflict was worth more
than either alone.

## Still owed, and it is the reason DV-8 stays in the queue

**The 36 rows already stranded are not healed.** They have no outbox entry to retry, so they need a
sweep, and DV-8 is now that sweep and nothing else. The entry records the one thing a sweep must
get right: **re-queue, do not mark synced.** A stranded tombstone is indistinguishable from one
whose mutation never got queued at all, so marking it synced would drop a delete that never landed.
Re-pushing is idempotent; assuming is not.

## Not exercised

No device run — this is the JS sync engine, so it reaches the phone through a normal Railway deploy
with no APK. What ran is the unit suite against a fake store. **The reproduction is of the
mechanism, not of the phone's incident**: I have shown the code permits exactly this strand, not
that this is what happened on 2026-08-19. The 36 rows are the evidence for that, and they are
consistent with it, but no log survives from those pushes.

<a id="2026-09-26-dv8-requeue-stranded-tombstones"></a>

# 2026-09-26 — DV-8: heal the 36 food tombstones the confirm fix cannot reach

**Branch:** `fix/dv8-requeue-stranded-tombstones` · **Lane A** · closes DV-8's heal; the `set_logs`
question and the device pass stay open.

The cause shipped earlier today: `pushMutations` deleted a batch's outbox entries and *then* ran an
unguarded per-domain confirm loop, so one arm throwing left every row after it `pending` with its
outbox entry already gone. Nothing retries a mutation that is no longer queued, and `applyDelta`
only overwrites `synced` rows — so those rows were stranded permanently.

**That fix reaches nothing already stranded.** Device Verification measured 36 `food_logs` rows
stuck `pending` with both outboxes empty, every one a delete tombstone, spread over 14 days. This
is the sweep for them.

## What it does, and the one decision that matters

`requeueStrandedFoodTombstones(userId, cutoffIso)` sits in `pushMutations` beside the two sweeps
already there. It finds `food_logs` rows that are `pending`, carry a `deleted_at`, are older than
the grace period, and have no `food_logs` outbox entry — and queues a fresh
`{ id, deleted: true }` mutation for each.

**It re-queues and never marks synced.** A stranded tombstone is indistinguishable from one whose
mutation was never queued at all, so flipping it to `synced` drops a delete the server may never
have seen: the food comes back on the next device, with its calories. Re-pushing costs nothing —
the server's `food_logs` arm branches on `p.deleted` and calls `deleteFoodLog(id, userId)`, a soft
delete by id, so a second delete of an already-deleted row is a no-op. That asymmetry is the whole
argument for a sweep rather than a one-line UPDATE, and it is the assertion the test leads with.

It shares **one** cutoff variable with the workout sweep rather than computing its own. Two
independently-computed cutoffs drift apart under a slow sweep, and the later one can then re-sweep
a row the earlier one has just queued.

## `food_logs` only, deliberately

The confirm-throw cause was generic across all 17 domain arms. The measured population was 36 food
tombstones and **zero** rows in every other table — and the cause is fixed, so a general sweep
would be per-domain SQL maintained for a population that should never grow. If another domain is
ever found stranded it needs its own arm; this one will not reach it. Written into the entry so the
next reader does not assume coverage it does not have.

## Verification

- Full suite green; lint **831**, exactly baseline; `check-test-typecheck` at baseline; Custom
  Rules **80 of 80**. No version bump — nothing user-visible changed on its own.
- Mutation pass, 4 real mutants + 1 control. Marking the row synced instead of re-queueing killed
  3; dropping the `deleted_at` filter, dropping the grace period, and computing a second cutoff
  killed 1 each.
- **The control failed first, and the test was wrong rather than the code.** Renaming the loop
  variable killed two assertions, because they matched `String(r.id)` and `String(r.date)`
  literally — pinning an identifier, not a behaviour. Loosened to `String(\w+\.id)`; the control
  then survived and all four real mutants still die. Source-level tests pin syntax by nature,
  which is the argument for checking them against a rename before trusting them.

## Not exercised — and this is the significant one

**The SQL has never run.** Both vitest projects run in `node`, where `getLocalStore` returns null,
so there is no local SQLite to drive; that is why this file's siblings
(`dv10-supplement-delete-tombstone`, `dv15-stale-pull-cannot-resurrect`) are source-level too. What
is tested here is the statement's shape and the call contract — that the sweep is invoked from
`pushMutations`, before the drain, guarded, with the shared cutoff.

So the heal is **owed a device pass**: zero `pending` rows in local `food_logs` against an empty
outbox on the S25, after a sync. DV-8 keeps that as its first `Keep:`. Until then the honest
statement is that the sweep is written and wired, not that the 36 rows are healed.

<a id="2026-09-26-feat-collection-cat-names"></a>

# Every cat gets a name, merges rename, breakdowns give the same cats back

**Branch:** `feat/collection-cat-names` · **2026-09-26** · **v1.468.0**
**Follows:** [`2026-09-26-feat-collection-pen-widget.md`](#2026-09-26-feat-collection-pen-widget) (#1706)
**Filed:** PS-52 (attachment ideas, Lane O) · **Amended:** PS-49 (keep the lineage fold)

## What the owner asked for

Unique cute names with a tag under each cat; a merged cat renamed from its merge; a decayed T2
breaking back into T1s; small cats in front and bigger ones further back and higher, maybe flying;
cats that stand out more; and ideas that make people attached enough to stay consistent.

## What shipped

- **The fold holds real cats, not counts** (`packages/shared/src/collection/ladder.ts`). The rules
  and their order are unchanged, `stock` is derived from the lists, and every existing ladder test
  still passes. Merges take the oldest cats; decay takes the newest loose cat and breaks the
  smallest big cat back into **the exact cats it was made from**, names intact. It already broke
  down before; now the same cats come back. New on the state: `cats` (top level, with `from`),
  `restless` and `lastLost`. The route did not change; it returns the whole state.
- **Names** (`names.ts`): deterministic from identity, from 80 cute names. A merged name blends the
  oldest part's opening with the newest part's ending ("Pudding" + "Waffle" → "Puffle").
- **Pen:** a name tag under every cat; depth by tier (T1 small at the front, each tier further back
  and higher); T5–T6 fly with a bob above a faint shadow; every cat has a ground shadow.
- **Card:** "Onyx is getting restless — train today to keep everyone" when skipping today would cost
  a cat, and "Pip wandered off on 12 Sep" in place of the old anonymous count.
- **`/collection`:** a roster per ladder listing each cat's name, tier, arrival day and the cats it
  was made from.

## Lane note

`ladder.ts` is Lane A's path. It was changed here because the owner asked for this in-session. The
change keeps every existing test green, and PS-49 now records that the lineage fold must be kept.

## Not exercised

The signed-in card on `pnpm dev` (no local Postgres); the S25; real production history through the
lineage fold (the counts are proven equal by tests, and names on the owner's data have not been
seen). The real engine and pen were rendered on the dev server through a temporary public page over
synthetic history; a fresh headless profile showed zero hydration errors.

## Gates

`pnpm check:rules`: see the PR. Unit tests: 9 files / 83 tests across the collection. eslint and
`tsc --noEmit` are clean.

<a id="2026-09-26-feat-collection-pen-widget"></a>

# The collection becomes a pen of wandering cats; six tiers, shinies, scenes

**Branch:** `feat/collection-pen-widget` · **2026-09-26** · **v1.467.0**
**Follows:** [`2026-09-26-art-cat-collection-art.md`](history-2026-09-27-folded-1.md#2026-09-26-art-cat-collection-art) (#1694)
**Filed:** PS-51 (titles unlock scenes) · **Amended:** PS-48 (③ answered), PS-49 (tier table,
workout decay rule, rares), BF-126 · **Plan:** [`2026-09-26-cat-collection-rules-v2.md`](../superpowers/plans/2026-09-26-cat-collection-rules-v2.md)

## What the owner asked for

After #1694 merged, the owner pointed out that the Collection card was *"just a static image and
count"* and asked for **a Home widget of moving sprites** at about the HR card's size, **more
sprites** including rares, lucky procs and variations, **six tiers**, then **cats that move like
cats** (*"even basic gif like 3 movements would be good"*) using the whole card, and **backgrounds
unlocked by titles**.

## What shipped

- **`CollectionPen`** replaces the Home card's single sprite. Every held cat, up to 12 and biggest
  first, wanders over a backdrop scene: each has its own start slot across the width, a 2D walk on
  the scene's ground, a slight shrink as it moves back, and turns around at each end. Pure CSS
  transforms, so no timers. It pauses off screen, in idle tabs and while the app is backgrounded,
  and stops under reduced motion.
- **Self-animating sprites.** Every SVG carries its own `<style>`: tail swish, alternating paws, a
  blink and a breathing bob, in three held poses per loop (`step-end`), per the owner's
  "3 movements". Stepped poses also keep repaints to a few per second, which matters with a dozen
  filtered sprites on the phone. Per-file delays stop a pen of identical cats swishing in unison.
- **Art:** a mythic T6 per class (Tank: gold horned helm; Ranger: antlers and a spirit bow; Rogue:
  glowing daggers and smoke; Health cat: great wings and a star staff), and a **shiny recolour of
  every tier**. That makes 48 sprites, plus four **scenes** (meadow, forest, house, castle). All are
  generated by `scripts/collection-art/build.mjs`; the drift test covers all 52 files.

## Decided in-session

- **Workout tiers: 1 · 5 · 20 · 100 · 300 · 900 sessions** (costs 5·4·5·3·3), from the owner's
  "100 days → big tier, three of those → yearly, one more much later". At 110 unbroken sessions he
  would hold 1×T4 + 2×T2.
- **Workout decay is per-user and gap-only**: nothing is lost on days inside the user's own rest
  allowance (`maxCompliantRestGap`), and one T1 is lost per day beyond it. That is exactly his case
  (*"5 workouts per week earn 5 … my 2 days of not training doesnt kill any … but 3 would"*) and
  generalises to any schedule. His alternative, 1.5 earned per workout and 0.35 drained a day,
  works only for his own schedule and was not taken. The constant drain stays for steps.
- **Rares and lucky procs must be pure functions of the day** (hash of user, faucet and date) so the
  replay stays a replay. The rates in the plan are proposals.

## Found while running it

- **The dev browser served stale CSS and JS.** Next dev keeps the same chunk filename when a chunk's
  content changes, so the preview pane kept an old stylesheet: no pen animation at all, and
  "hydration mismatches" whose client values came from the *previous* formula. A fresh headless
  Edge profile showed zero hydration errors. If a dev render disagrees with the source, refetch the
  chunks with `cache: 'reload'` before debugging the code.
- `/cats/*.svg` sits behind the auth middleware. For the local check only, the matcher excluded
  `cats/`; that change was reverted before commit, and the committed middleware is unchanged.

## Not exercised

The signed-in Home card on `pnpm dev` (no local Postgres); anything on the S25, including the
pen's frame rate with 12 filtered sprites animating on Samsung's WebView; offline first view.
The in-SVG animations are not paused by the pen's off-screen pause (an `<img>`'s internals are
beyond host CSS). Chromium does not paint off-screen images, but that is unmeasured on the device.

## Gates

`pnpm check:rules`: see the PR. Unit tests: 5 files / 47 tests. eslint and `tsc --noEmit` are clean.

<a id="2026-09-26-la146-vitest-teardown-flake"></a>

# 2026-09-26 — LA-146: CI absorbs the vitest teardown flake, narrowly

**Branch:** `fix/vitest-teardown-flake-retry` · **Lane A** · entry LA-146 (removed from the queue)

## What this is

A full run exits 1 while reporting **zero failing tests**, with one line:
`EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending`.
Ten sightings, ten clean re-runs on identical code — and two of them landed on one day, which is the rate change that moved this to rank 1. It was free until 2026-09-25, when `Tests`
became a **required** check — so it stopped costing a re-run and started blocking the merge button.

## It is upstream's bug, and that is now evidenced rather than assumed

[vitest-dev/vitest#11153](https://github.com/vitest-dev/vitest/issues/11153) — open, `p3-minor-bug`,
no fix. The reporter measured **3/10 runs failing on 4.1.11 and 3/10 on 5.0.0**, against **0/10 on
3.2.4**. They also measured `maxWorkers: 1` (still 2/10, 5× slower), `isolate: false` (still 2/6,
and it broke tests in 2 of 6), `silent: 'passed-only'` (3/10), console spying in a setup file
(3/10) and draining pending work (no effect).

**This retires a stale claim in `docs/local-dev-database.md`**, which said *"not fixable by
upgrading — 4.1.11 is the latest 4.1.x and no 4.2 exists"*. Vitest **5.0.2 exists now**. The
conclusion survives and the reason does not: upgrading is still no use, because the regression
carries into v5. Only 3.2.4 is clean, and this config uses `projects`, which is v4+.

## What shipped

`scripts/ci/vitest-retry-teardown-flake.js`, wired at the `test-shard` step, re-runs a shard once —
and only when the run carries that exact error **and** reports zero failing tests **and** zero
failing files. This automates the response the entry already prescribed (`rerun_failed_jobs`), but
inside the job, so it costs one shard rather than a workflow re-run that also cancels and restarts
the 34-minute E2E.

**It cannot turn a red green.** A false positive costs one extra run, because a real failure recurs
on the retry. A second occurrence in the same job fails the job, and every retry prints a greppable
`[vitest-retry]` notice so sightings keep being counted.

## Why not the structural fix

`disableConsoleIntercept: true` would make the race **impossible**, not rarer — vitest installs the
worker-side RPC console sender only when that option is false
(`if (!config.disableConsoleIntercept) await setupConsoleLogSpy()`), and that sender is the only
caller of `rpc.onUserConsoleLog`. I verified that chain in the installed source rather than
inferring it.

Its cost is what ruled it out, and **the cost this repo had written down was wrong**. The doc said
it *"costs per-file log attribution for everyone"*. Measured: with intercept on, a **passing**
test's `console.log` is dropped entirely and only a **failing** test's output is kept and
attributed — so there is much less attribution on offer than claimed. The real cost is volume:
across `lib/data/postgres/__tests__/` (176 files) the log goes from **12 lines to 526**, 342 of them
`[ensureSchema]`. Over a full shard that buries the failure you opened the log to read. Two in one
job is the evidence that would justify paying it anyway.

## Mutation pass

8 deliberate defects, all killed; 2 deliberately equivalent controls, both survived.

A ninth mutant — removing the ANSI-stripping from the matcher — survived, **and the right response
was to delete the code rather than write a test for it.** I had stripped escape codes before
reading the summary lines, on the theory that a coloured `failed` would defeat `\bfailed\b`.
Measured: vitest emits those two summary lines **unstyled even under `FORCE_COLOR=3`**, and CI is
not a TTY. It was defence against something that does not happen, so it went. The matcher's docstring
now records the bound that makes that safe: a misread costs one wasted run, never a false green.

## Not done

The flake itself is not fixed and cannot be fixed here. When vitest#11153 closes, delete the
wrapper and go back to `pnpm vitest run` — that is the one thing this change owes, and it is
conditional on upstream rather than on us.

## Not exercised

No device run and none applicable — CI tooling only, no product code, no APK. The retry path was
proven with a scripted runner (16 tests) and the real spawn path was exercised end to end for exit
codes (green → 0, red → 1, vitest invoked once, no retry). **The one thing not exercised live is a
genuine occurrence**, because the fault is not reproducible on demand — 24 controlled runs produced
none. What was verified is the policy around it, not a real interception.

<a id="2026-09-26-la147-refit-rate-limit-bucket"></a>

# 2026-09-26 — LA-147: a duration change stops spending the model's budget

**Branch:** `fix/la147-refit-rate-limit-bucket` · **Lane A** · closes `LA-147`.

`RV-202 ②` stopped a duration change from calling the model but left it spending the model's
allowance. The prescribe route took one `rateLimit('prescribe:<user>', 20, 1h)` before it knew
which kind of request had arrived, so twenty preset switches in an hour produced "Too many
requests" for work the AI never saw. The limit's own comment cited preset-switching as the reason
it was 20 rather than 10 — the justification had outlived the behaviour it was written for.

## Two buckets, and the ordering the entry worried about

- `prescribe-any:<user>` — **60/hour**, checked FIRST, before the body is read. It bounds every
  prescribe request of either kind.
- `prescribe:<user>` — **20/hour**, the model's own, checked on the generation path only.

A preset request that falls through to a real generation (no stored plan, expired, a pending
whole-session deload) reaches the second check and is charged, which is right: it is about to
spend tokens.

**The entry's ordering catch is softer than it states, and that changed the design.** It says the
branch "is only knowable after `getSessionPeriodization`". It is not — `durationPreset` comes from
the parsed request body, before any repository read. What *is* only knowable later is whether the
re-fit will succeed. So the tempting shape is to parse first and then pick a bucket; that would
move the only guard behind a body read, letting a caller spend parses by omitting the field that
decides the branch. Keeping a cheap ceiling in front and charging the model's bucket on the branch
that reaches it gets both properties with no reordering.

The re-fit is not free either — it runs a full `aggregateSignals`, about 30 repository reads — so
60/hour is a real bound rather than a formality.

## Measured on the dev server

Limiter rows cleared, one real generation to have something to re-fit, then preset switches:

- **25 switches, all 200.** Before this the 20th would have been a 429.
- Buckets afterwards: `prescribe-any` **26**, `prescribe` **1**. The 25 re-fits spent nothing of
  the model's allowance — the whole point, read straight out of `rate_limits`.
- Pushed further: the **first 429 lands at `prescribe-any` request #61**, exactly the ceiling, with
  the model bucket still at **1** after 59 re-fits.

## Verification

- Full suite green; lint **831**, exactly baseline; `check-test-typecheck` at baseline; Custom
  Rules **80 of 80**. No version bump — the change is only visible when you were being throttled
  wrongly.
- 5 new tests. Mutation pass, 3 real mutants + 1 control: collapsing back to one bucket killed 3,
  dropping the model check on the fall-through path killed 2, and moving the ceiling behind the
  body parse killed 1. The control — swapping the two constants' declaration order — survived.

## Not exercised

**A second replica.** The limiter's authoritative store is the `rate_limits` table with an
in-memory L1 in front, and the documented accepted lag is that a cold replica can let a few
requests through before its first DB round-trip. Everything above ran against one dev process, so
the two buckets were verified per-process; nothing here changes that shared-store behaviour, but
nor did this run test it.

**No device.** The failure this fixes is a toast on the pre-workout screen, and the toast itself
was not seen — only the status codes behind it.

<a id="2026-09-26-la148-one-median"></a>

# 2026-09-26 — LA-148: one median, and the live-HR value that was quietly biased upward

**Branch:** `refactor/la148-one-median` · **Lane A** · closes `LA-148`, files `LA-151`

## What shipped

`packages/shared/src/stats.ts` — `median` and `quantile`, domain-neutral, one copy. Six
implementations were retired into it.

## The entry said four. There are fourteen.

`LA-148` scoped its own grep to `packages/shared/src/health/**` plus one workout file, so
everything under `lib/` and `app/api/` was invisible to it — and it missed four inside its own
declared scope as well. Measured across the repo: **fourteen**, with three different tie-breaks and
four different answers for an empty list.

Six are now one. The remaining eight are `LA-151`, filed with the per-site table, because they are
not a mechanical sweep — see below.

## The defect that mattered, and it was not the one the entry named

The entry flagged `hr-smoothing.median` for returning **`0`** on an empty list, and called changing
that "the whole of the work". Checking the callers showed the opposite: all three guard against
empty (`recent.length < 3`, a `beats.length ?` ternary, and an early `return null`), so that branch
was already dead.

The live defect was the one nobody had written down. `hr-smoothing.median` returned the **upper** of
the two middle values, so every even-count window was biased upward — and the live-HR readout runs
on exactly that. Beats `[80, 82]` surfaced as **82**, a value the ring never measured, where the
midpoint is 81. Five existing tests encoded this deliberately, with comments explaining the
tie-break.

The same pair — upper-middle plus `0`-on-empty — is still live in `ai-periodization/acwr.ts`, which
feeds training-load advice. That is `LA-151`'s first item.

## The decision the consolidation forced

The canonical median returns `52.5` where the old one returned `53`. Every other live-HR source
emits an integer bpm and the value renders raw, so a fractional readout would have been a
user-visible regression introduced by a refactor.

**Resolution: the statistic stays canonical; the live-HR path rounds at its display boundary**
(`Math.round`, in `smoothedBpmFromFrames`), the same shape cadence already uses for its 1 dp.
Rounding is a presentation concern and does not justify a second median. `rollingMedian` is left
unrounded on purpose — it feeds chart y-values and `recovery-index`, never a displayed bpm.

Rounding recovered three of the five changed fixtures exactly. **Two genuinely change** and their
expectations were corrected rather than worked around: `[80,82]` → 81 (was 82) and `[66,68]` → 67
(was 68) — the cases where the middles differ by 2, so the old upward bias is visible rather than
hidden by the half-step.

⚠ **Live HR is not device-verified here.** The sandbox has no ring. The change is bounded — at most
1 bpm, only on even-count windows — but the canonical runtime is the APK and this was not seen on it.

## Verification

- Mutation pass, 4 mutants + 1 equivalent control: upper-middle (**17 tests killed it**),
  `0`-on-empty (7), quantile without interpolation (2), dropping the display rounding (3);
  control `>> 1` → `Math.floor` **survived**, as it must.
- 10 new tests on `stats.ts`, including both halves of the retired divergence.
- Full suite, `check:rules`, lint, `tsc`, `typecheck:tests` — see the PR.

## Files

- **new** `packages/shared/src/stats.ts`, `packages/shared/src/__tests__/stats.test.ts`
- retired copies: `health/daily-medians.ts`, `health/energy-balance.ts` (`medianOf` deleted),
  `health/hr-smoothing.ts` (`median` deleted, `rollingMedian` inline copy removed),
  `health/cadence.ts` (`medianOf`/`median` → one `medianRounded` wrapper),
  `workout/time-audit.ts` (`median` + private `quantileSorted`)
- repointed: `hr-recovery-profile.ts`, `hr-recovery-trend.ts`, `sleep-verdict.ts`,
  `app/api/health-trends/route.ts`, `lib/live-hr/decode-live-hr.ts`,
  `components/oura-ble/live-hr-test-console.tsx`

<a id="2026-09-26-la149-announce-the-sleep-verdict"></a>

# 2026-09-26 — LA-149: the verdict now has a way to reach the surface

**Branch:** `feat/la149-announce-sleep-verdict` · **Lane A** · the other half of TN-81; unblocks TN-82

TN-81 landed the computation, the table and the repository methods, deliberately inert. This wires
them to an API so the morning sheet can announce the verdict and record the answer.

## Shape, and why it is a new route

`GET /api/sleep-verdict?date=` and `POST /api/sleep-verdict {date, state}`, rather than adding a
field to `/api/day-checkin`. That route returns the check-in object **directly**, so a new sibling
field would be a breaking change to its response — and the file that reads it is Lane B's, which
TN-82 rewrites anyway. A separate route costs one request on a sheet opened once a day and couples
nothing.

## The two rules the route exists to hold

**A stored verdict is returned, never recomputed.** This is the whole of TN-81: the announcement is
frozen with the values and bands behind it so a correction stays paired with what it disagreed
with. A route that recomputed on every read would undo that silently — the bands would drift under
the answer and nothing would look wrong. A mutant that recomputes is killed by the test.

**The route never writes a `touched` flag.** It writes `response_state` and nothing else. The
correction's *value* belongs to the check-in save path, which already owns that column; only his
own correction is his answer (TN-57).

Writing on a GET is deliberate rather than careless: the row records that an announcement was
**made**, and that happens exactly when the sheet reads it. No read, no announcement, correctly no
row. Repeating it is safe — `upsertSleepVerdict` is idempotent per `(user, date)` and never touches
`response_state`.

Two silences are distinguished, because they render differently: no sleep session yet (the ring
has not drained) and a baseline under 28 nights. Both return `200` with `verdict: null`; the second
adds `baselineNightsRequired` so the surface can tell "not enough history" from "nothing strange
about last night".

## Exercised on `pnpm dev`, against the real route and the local Postgres

Seeded 35 ordinary nights plus a short one, signed in, and drove both verbs:

- **GET #1** — computed `poor`, `triggered: ['duration']`, components `{5.2 h, −60 min, 89%}`,
  duration band `(7.5, 8.25)`, `baselineNights: 28`, `responseState: 'none'`, and the row appeared
  in `sleep_verdicts`. The `−60` is the onset helper reading 23:00 Brisbane correctly.
- **GET #2** — byte-identical, no recompute.
- **POST `corrected`** → `200`; **GET #3** → same verdict, `responseState: 'corrected'`.
- **POST for a day never announced** → `404`, not a silent `200`.
- **`day_checkins` touched flags: unchanged.** The two that are set are from 2026-09-22 and are
  `perceived_recovery` — pre-existing fixtures. Checked by timestamp rather than assumed, because
  "no touched flag" is the claim TN-57 exists to protect.

The seeded nights were removed afterwards and the seed's own 7 restored, so the local DB is back
where it started.

## TN-83 caught this before it shipped, and it was right

Tuning filed TN-83 while this was being built: the verdict reads `sleep_sessions` raw, and that
table holds **more than one row per date**. Measured over 125 real rows — 106 distinct dates, 30
rows under 3 h, onsets at 10:44, 16:37, 17:35 and 17:44. Judged raw it fails in **both**
directions: an afternoon nap is announced as a bad night, and the 0 h fragments sitting in the
trailing window drag `p25` down so a genuinely short night reads as acceptable.

Had this merged an hour earlier the owner's first announcement could have been *"your sleep was
bad"* on a 7.9 h night — the precise thing the design cannot afford in week one.

The fix is one import: `nightSessions()` already classifies nap vs night by circadian position and
merges fragments inside the night band, and fifteen sites route through it. This is the sixteenth.
Writing a selection rule here instead would have been the One-Formula-One-Place trap that Q-76
already closed once.

**My first test for it proved nothing.** It listed the real night before the nap, so the lookup
found the right row either way and passed with and without the import. `listSleepSessions` orders
by date and two rows share one, so which arrives first is undefined — the nap now goes first, and
the test fails without the fix. Verified by reverting the import, not assumed.

## Mutation pass

8 deliberate defects, all killed; 2 deliberately equivalent controls, both survived.

One mutant was **mis-specified and is worth recording as such**: "store a verdict below the
coverage floor" only removed a response field, because the early return it meant to delete is
guaranteed by the type system — the code after it dereferences a value TypeScript knows is `null`.
So it was really a third control. It did surface something real, though: `baselineNightsRequired`
is part of the contract TN-82 reads and nothing pinned it. It is pinned now.

## Not exercised

**TN-83's re-measure is NOT done and is not this PR's.** Its 10.9-announcements-per-30-nights
figure was counted over rows rather than nights, so it does not survive the fix; the rate has to
be re-run over `nightSessions()` output before anyone touches `VERDICT_IQR_MULTIPLIER`. The entry
says so.

No device run, and none applicable yet — this is a server route with no UI. The surface that
announces it is TN-82 (Lane B), which now has its `Needs:` cleared and needs the APK for its own
pass. Nothing here has been exercised against drifted production data: the owner has 119 nights, so
the coverage floor will be satisfied on the first real read, which is the opposite of the local
seed's 7 and worth knowing when the surface lands.

<a id="2026-09-26-la150-unfillable-hr-sessions"></a>

# 2026-09-26 — LA-150: a session that ended before the first heart-rate reading is not pending work

**Branch:** `fix/la150-bound-hr-backfill-scan` · **Lane A** · closes `LA-150`.

Both HR backfill work lists floored their scan at a flat 180-day retention window.
`oura_heartrate` is **younger than its own retention window** — its first row is 2026-06-22, and
the floor reaches back to 2026-03-30 — so every session in that gap matched the predicate forever.
Each run reported the same count and filled nothing, which reads exactly like a broken backfill.
The device agent hit it on 2026-09-24 and reasonably asked whether the raw samples had been pruned.

The fix is one predicate: `completed_at >= (SELECT MIN(timestamp) FROM oura_heartrate WHERE …)`.

## Measured against production first, and the entry was right

For once the entry's numbers held up exactly. Read through the admin endpoint on 2026-09-26:

| work list | pending | unfillable | genuinely fillable |
|---|---|---|---|
| `listSessionsMissingSetHrStats` (the one LA-150 named) | 33 | **33** | 0 |
| `listSessionsMissingHrStats` (the sibling it did not) | 36 | **34** | **2** |

Earliest heart-rate row: `2026-06-22T01:26:45Z`. Oldest pending session: `2026-04-30`.

## Two things the entry did not say

**The sibling has the identical defect.** `listSessionsMissingHrStats` — the whole-session list
behind `/api/oura-ble/backfill-hr-stats` — is the same shape: a retention-day floor on `started_at`
plus a coverage-aware `readings_count = 0` predicate. LA-150 named only the per-set one. Both are
fixed here, per the sibling-surface rule. The sibling is the more interesting of the two, because
its list is **mixed**: bounding it removes 34 phantoms and leaves the 2 real items visible instead
of buried.

**The bound belongs on `completed_at`, not `started_at`.** The entry said "bound the scan at the
earliest `oura_heartrate.timestamp`" without naming a column, and the obvious reading — tighten the
existing `started_at` floor — would discard a session that began ten minutes before the first
reading and ran across it. Its window is partly coverable, so it is real work. A test covers that
straddling case directly, and the mutation that moves the bound to `started_at` fails it.

A NULL from the subquery — no heart-rate rows at all — makes the comparison NULL and excludes every
session. That is the right answer for an account with no HR data, and it needs no special case.

**No sentinel row**, per the entry's explicit prohibition: the coverage-aware `readings_count = 0`
predicate exists precisely because empty rows used to hide real gaps (Q-11 Defect B), and writing
one under another name walks straight back into it.

## Verification

- Full suite green; lint **831**, exactly baseline; `check-test-typecheck` at baseline; Custom
  Rules **80 of 80**. No version bump — nothing user-visible changed.
- A new DB-backed test (`la150-unfillable-sessions.test.ts`, 4 cases) covers the drop, the straddle,
  the no-readings case and the retention floor still applying.
- **Three** existing DB-backed files needed a heart-rate row added to their fixtures. They are about the
  soft-delete filters and the coverage rule, and with no readings at all the new bound emptied
  their lists — so every `toContain` failed and every `not.toContain` would have started passing
  for the wrong reason. The fixtures now seed one reading old enough to keep their sessions
  fillable, which is the honest fix rather than loosening the predicate. **The third
  (`oura-workout-hr-stats.test.ts`) only surfaced in the full suite** — I had run the two I
  reasoned my way to and missed the one covering the sibling list I had just changed.
- Mutation pass, 3 real mutants + 1 control: moving the bound to `started_at` killed 1 (the
  straddle), removing it from the per-set list killed 2, `MIN → MAX` killed 1. The control
  (`>=` → `>`, on timestamps that never collide exactly) survived.
- **`MIN → MAX` survived the first run**, because every fixture had exactly one heart-rate row, so
  the two agreed. That is the worse mutant of the pair — `MAX` would exclude every session older
  than the most recent reading, which in production is nearly all of them. The first case now
  seeds two readings so the fixture can tell them apart.

**Not exercised:** production. The measurements above are reads, not a run of the backfill route
against the fixed query — so the predicted "33 pending → 0, 36 → 2" is a calculation from the same
data the route would see, not an observed result. Running either backfill endpoint after deploy
would confirm it, and either reporting nothing pending is the signal.

<a id="2026-09-26-la151-acwr-median"></a>

# 2026-09-26 — LA-151 ①: the ACWR median, and the consumer the entry named that does not exist

**Branch:** `refactor/la151-acwr-median` · **Lane A** · closes `LA-151`'s `acwr.ts` item

## What shipped

`computeVolumeAcwr` computed `typicalSessionVolumeKg` as `sorted[floor(n/2)]` — the upper of the
two middles, with `0` for an empty window. It now uses the shared `median` from `stats.ts`
(LA-148), keeping `?? 0` because every consumer is typed against `number` and the window is gated
by `minSessions` before anything acts on it.

Also corrects the score audit's display, which had begun contradicting itself.

## The entry's reason for taking this first was wrong

`LA-151` — which I wrote — said take `acwr.ts` first because it "feeds training-load advice". It
does not. `typicalSessionVolumeKg` is declared on `ActivityScoreInput` and **never read**:
**Q-190** replaced the volume lane's denominator with the absolute `sessionVolumeGoalKg`, on the
reasoning that a target built from the user's own median is a treadmill — train harder, the median
rises, the target rises, the score stays put.

So the bias reached a **display** and nothing that computes. That is the third entry today whose
measurement was sound and whose conclusion about blast radius was not, and the check cost ten
minutes.

## Measured before assuming

Over the owner's **119 real sessions across 180 days**, comparing the two tie-breaks on each
rolling 28-day window:

| | |
|---|---:|
| days simulated | 121 |
| identical | 74 (61%) |
| differ | **47 (39%)** |
| median absolute difference | **1.85%** |
| largest | **21.13%** |
| upper-middle higher on every differing day | **yes** |

Always upward, so it was a systematic bias, not noise. Had it still been the volume-lane
denominator, a higher denominator would have made the target harder and depressed the score on two
days in five — which is exactly why the measurement came before the edit rather than after. No
score moves, so no owner gate.

## The contradiction in the audit

Two adjacent rows of the score audit the owner can open:

- `sessionVolumeGoalKg` — *"Absolute per-session target (Q-190) — deliberately NOT the median of
  your own sessions."*
- `typicalSessionVolumeKg` — *"Median single-session tonnage — **the volume-lane denominator**."*

Q-190 changed the first and left the second's note behind. The second now says it is reported for
context and points at the row above.

## The test that was doing nothing

`typicalSessionVolumeKg is the median session volume` used three sessions — an **odd** count — so
it passed under both tie-breaks and pinned neither. Added an even-count case (500/1000/3000/5000 →
2000, not 3000) and an empty-window case, then **verified the new test fails against the old
implementation** before restoring.

## Not done

The other seven copies in `LA-151`, and the dead `typicalSessionVolumeKg` input, which is threaded
through six files and is cleanup rather than part of this fix. Both recorded on the entry, with the
lesson: establish what actually reads a number before deciding how risky its tie-break is.

<a id="2026-09-26-la151-remaining-medians"></a>

# 2026-09-26 — LA-151: one `median`, one `lowerMedian`, and four that stay private

**Branch:** `refactor/la151-remaining-medians` · **Lane A** · closes `LA-151`, files `LA-154`.

`LA-148` consolidated six copies of the median into `packages/shared/src/stats.ts` and said four
remained. `LA-151` said eight. The census found **eleven**, and neither earlier count was low
because the work was hard — both were low because the grep was scoped. `LA-148` looked only in
`health/**`; `LA-151` looked where `LA-148` pointed, inheriting that blind spot and adding two of
its own.

The census that settles it is one line:
`grep -rn "length % 2" packages/shared/src lib app`, plus a scan for `function median*`.

## What moved

Nine consolidated: `hr-recovery-by-exercise`, `sleep-score`, `temperature-baseline`'s frame
series, `hrr-trend`, `cadence-tracker`, `auto-detection-service`, `daytime-stress`,
`device-comparison`, `oura-ble/decode` — plus `acwr.ts` earlier.

**No number moved.** Every one already averaged the two middles; what differed was the empty case,
and each was decided from its callers rather than swapped: `hr-recovery`'s NaN sat behind a
`length === 0` guard that made it unreachable, `cadence-tracker`'s `0` and
`auto-detection-service`'s `NaN` are kept as documented adapters because both feed a classifier
that takes plain numbers, and `decode`/`daytime-stress` already returned early on empty.

## `lowerMedian` is a concept, not a copy that drifted

Three callers want the LOWER of the two middles. `oura-models/daily-baselines.ts` and
`cumulative-stress.ts` mirror `torch.median` and their goldens pin it — 46.923 over 14 symmetric
values only comes out of the lower middle. `/api/oura-ble/step-counter-export` is a diagnostic
console where averaging `[1, 2, 3, 4]` into 2.5 Hz reports a stride frequency the ring never
decoded. It is now one named function in `stats.ts` with that reasoning attached, and a docstring
saying to use `median` unless you can name which of the two reasons applies.

**I consolidated that third one to `median` first, and the suite caught it** — a test named
"taking the LOWER median of an even count" whose comment said the route *"deliberately takes an
actual observed value rather than inventing one between two."* The reason was written down; I
changed the code before reading it.

## Four stay private, with the reason recorded so they are not re-swept

`sleep-staging.ts` is nearest-rank — a different definition, and the file's own `quantile` is used
at q=0.05 and `WAKE_MOVE_QUANTILE`, so moving the median alone would leave two definitions in one
file. `hrv-5min.ts` is pinned to a `torch.quantile` citation and equal to canonical at q=0.5.
`temperature-baseline`'s `median7` is `sorted[3]` of a fixed 7-slot ring buffer in a per-sample
loop. And `daytime-stress`'s `hrMinMedianMax` is **not a median** — it reads positionally from an
already-ordered `[min, median, max]` triple.

That last one bit me in both directions. A first pass read only the positional helper and
concluded the file had no median copy, which would have written a wrong correction into the
backlog; the census found the file's *other* function, a real median at line 186, which is now
consolidated.

## Verification

- Full suite green; lint **831**, exactly baseline; `check-test-typecheck` 317 across 88 files,
  none above baseline; Custom Rules **80 of 80**.
- Mutation pass, 3 real mutants + 1 equivalent control. `lowerMedian` returning the upper middle
  killed 2 (the export route and a torch golden); the temperature series taking the lower middle
  killed 1; the control (`=== null` → `== null` on an already-nullable) survived.
- **One mutant survived and it was worth chasing.** Removing `auto-detection-service`'s
  `Number.isFinite` filter killed nothing. It is not an equivalent mutant —
  `median([Infinity])` is `Infinity` filtered vs `NaN` unfiltered — but it is unobservable through
  every caller: `classifyGait` guards `Number.isFinite` on all three features itself and answers
  `idle`, and the only other consumer is a calibration console. Its sibling `cadence-tracker` has
  never filtered. That asymmetry is now a comment in the file saying it is belt-and-braces and not
  a bug to unify, because unifying it in the wrong direction would change device gait
  classification for no reason.

**Not exercised:** no device. `cadence-tracker` and `auto-detection-service` are both APK-only
paths — their callers decode live ring frames, and nothing in the sandbox produces one. The
consolidation is behaviour-preserving by construction (same tie-break, empty case unreachable at
n=1), and the ported-model goldens cover `lowerMedian`'s two other callers, but the gait path
itself was not run on hardware.

## Filed

`LA-154` — `typicalSessionVolumeKg` is a dead input threaded through ~6 files into a function that
never reads it, left behind when `Q-190` replaced the volume lane's denominator. Declined here
rather than widening a math consolidation into a type-surface change.

<a id="2026-09-26-la154-dead-typical-session-volume"></a>

# 2026-09-26 — LA-154: the dead volume input, and three stale comments behind it

**Branch:** `fix/la154-dead-typical-session-volume` · **Lane A** · closes `LA-154`.

`Q-190` replaced the activity score's volume target — it used to be
`typicalSessionVolumeKg × strengthFreqGoal`, the median of the user's *own* sessions, which meant
training harder raised the target and the score stayed put. It became an absolute
`sessionVolumeGoalKg × strengthFreqGoal`. The median input stayed behind.

## The entry I filed for this was wrong about scope

`LA-151` filed `LA-154` saying to remove the field everywhere, with "the score audit no longer
prints a row for it" as the done-when. That would have deleted something deliberate: the audit row
exists, is rendered, and is correctly labelled *"Reported for context only — Q-190 took the volume
lane off it"*. The field's own docstring said as much — **"Kept because the audit view displays
it."** So the thing `LA-151` announced as a discovery was already written at the declaration.

What was actually dead, checked surface by surface:

| surface | verdict |
|---|---|
| `ActivityScoreInput.typicalSessionVolumeKg` | **dead** — the scoring function never reads it, so four call sites passed a value only because the type demanded it |
| `activitySignals.typicalSessionVolumeKg` (readiness payload) | **dead** — written into the payload, read by no UI |
| the score-audit row | **alive** — rendered, and its note is accurate. Kept |

## What that uncovered

Removing the field made `load` — an entire `computeVolumeAcwr` call — dead in
`app/api/ai/health-insight/route.ts`. It existed solely to supply the median, so every request to
that route was computing an ACWR nothing used.

That in turn exposed a comment crediting the route's 28-day session fetch to the ACWR helper
(Q-512), which the route no longer calls. **The fetch has to stay wide anyway, for a different
reason the comment never gave:** the 7-day filter below it is anchored on the *requested* `date`,
which the body may set to any past day, while the fetch counts back from now. Narrowing it to 7
would silently drop sessions for any past-dated request. The comment now says that.

**And `Q-137`'s test comments had been wrong for six weeks.** They computed the volume target as
`4,700 × 3 = 14,100` and `4,700 × 5 = 23,500` from `typicalSessionVolumeKg × strengthFreqGoal` —
the formula Q-190 removed on 2026-08-11. The real targets are `5,000 × 3 = 15,000` and
`5,000 × 5 = 25,000`. Every assertion was right the whole time and the arithmetic printed beside
it was not, which is the hard kind of stale comment: nothing fails, so nothing draws attention.

`Q-190`'s own regression case — three different personal medians against one training week,
asserting the score does not move — **can no longer be written**, because the input is gone. That
is a stronger guarantee than the test was, and the file says so where the case used to be. What
replaced it is the positive half that still has teeth: the target responds to the *goal*.

## Verification

- Full suite green; lint **831**, exactly baseline; `check-test-typecheck` at baseline; Custom
  Rules **80 of 80**. No version bump — nothing user-visible changed.
- Mutation pass on `volumeTargetKg`: pinning the target to a constant killed 3, freezing
  `strengthFreqGoal` killed 4.
- **My first control was not equivalent and killed a test**, which is worth recording rather than
  quietly replacing: relaxing `Math.max(x, 1)` to `Math.max(x, 0.5)` looked like a no-op on goals
  that are never below 1, but a test asserts `volumeTargetKg({0, 0}) === 1` directly — the floors
  are the contract, not defensive padding. The real control, commuting the multiplication,
  survived.

**Not exercised:** the score-audit and Activity screens were not rendered. The change is a type
narrowing plus the removal of an unread payload field, so there is nothing for them to show
differently — but the audit row's continued presence was confirmed by reading `activity.ts`, not
by looking at the console.

<a id="2026-09-26-lane-b-dv12-trend-sparkline-memo"></a>

# 2026-09-26 — DV-12: the `memo` that was doing nothing, and 578 → 0

Lane B, v1.465.63. One comparator, one extracted module, one unit test file, one e2e guard. The
owner's highest-priority entry — *"speed/performance/efficiency when switching pages tabs is my
highest priority"* — now has a measured fix on its largest named cost.

## What it was

All five canvases on the Health tab are the same component, `TrendSparkline`, rendered five times for
Protein/kg, Steps, Water, Session Duration and Workout Density. It is wrapped in `memo`, and the
wrapper was doing nothing.

`TabVisibilityProvider` bumps `epoch` on every tab re-show and the screens refetch because of it —
deliberately, since all five tabs stay mounted and a bare `useEffect(…, [])` would show one snapshot
until the app was killed. The refetch hands the sparkline a **new `trends` array with the same
contents**, so `memo`'s default shallow compare sees a different reference, re-renders, rebuilds
`data`/`options` inline, and `react-chartjs-2` runs `chart.update()` — which re-measures every axis
label.

This is the repo's own standing rule one level up. *"`React.memo` only works with stable props"* is
written about an inline literal at the call site; here the prop is an **equal-valued array**, which
reads as perfectly stable until you check the reference.

## The metric, which is the part that unstuck this

Counting the canvas `font` setter — the top self-time item in the device CPU profile — rather than
timing the tap:

| | before | after |
|---|---|---|
| → Health (5 canvases) | **578**, six times out of six | **0**, six out of six |
| → a tab with no charts | 0 | 0 |

Timing could not settle it: `next dev` is unminified, in React dev mode and compiles on demand, so an
A/B of `resizeDelay` across all twenty charts was unreadable against that noise (87–480 ms before,
73–420 ms after). The setter count has no such problem.

## Two corrections I owed this entry

**The resize suspect was wrong** — instrumented with a control, `ResizeObserver` fires 5 chart
callbacks during load and **zero** on a tab switch, so `content-visibility` never triggers one. That
also explains the dead `resizeDelay` A/B: it was debouncing an event that never happens.

**And "the third Health switch cost 0 because that refetch returned nothing to redraw" was wrong too.**
It cost 0 because the probe waited 1500 ms. At 2000 ms it is 578 every time. The redraw is
deterministic, and the update is **redundant** rather than merely legitimate — which is what made
candidate ① the right one and left ② and ③ unspent.

## Why the comparator is extracted and heavily tested

Its failure mode is silence. A comparator that returns `true` too eagerly does not crash; it leaves a
stale chart, invisible until someone notices the numbers are old. So
`components/health/trend-sparkline-equal.ts` is its own module with eight cases, **five of them
must-redraw**: the drawn field changes, a day is added or removed, the dates roll at midnight, any
presentational prop changes, a value becomes null. Mutation-tested three ways — dropping the length
check, dropping the `date` comparison, dropping the presentational-prop guard — each caught by a
different assertion.

It **deliberately ignores a field this sparkline does not draw**. Five sit on Health pointed at five
metrics, so a refetch that moves protein should redraw one chart, not five. That is the saving, not a
hole.

## The e2e guard counts, it does not time

`e2e/dv12-tab-switch-does-not-redraw-charts.spec.ts`, with two controls so a zero cannot be vacuous:
the instrument must fire during load, and the five canvases must still be mounted at the end. Control
run against the unfixed component — **fails**, *"a tab switch re-measured the chart axes"*.

## Not verified

**`Verify: device`.** The pass test is unchanged: `perf.js longtasks`, every tab tap's longest task
under 50 ms on the S25. This removes five chart redraws per tap; whether that alone clears 50 ms on the
phone is unmeasured, and the harness cannot say, because its timings are dominated by dev-mode work the
APK never does.

<a id="2026-09-26-lane-b-lb160-shared-comment-stripper"></a>

# 2026-09-26 — `lane-b/lb160-shared-comment-stripper` (LB-160) — 88 source-scan tests, one stripper, and a ratchet to keep it that way

**Lane B · one entry shipped (LB-160) · one new Custom Rules step.**

A source-scanning test that strips comments with a regex pair is reading a file the regex has
already damaged. The pair has no idea what a string literal is, so the `/` and `*` inside
`accept="image/*"` open a comment for it and it deletes everything to the next closer.
`scripts/lib/strip-comments.js` walks string literals properly — LA-64 extracted it for exactly
this, for the CI checks. The tests never got it.

## The population was 88, not 37 — my own entry was wrong

LB-160 was filed yesterday claiming 37 files, and that number came from a grep for one of the five
comment regexes (`{/* … */}`). **Files using only the other four were invisible to it: 51 more.**
The check written for this entry found them, which is the argument for a check over a count.

The correction matters beyond the arithmetic: the measured harm — 11 source files carrying the
trigger, 4 test→file pairs reading one, losses of 25–56% — was computed against the 37, so it is a
floor rather than the total.

## What the conversion found, which was less than expected and worth saying

The honest result: **converting all 88 exposed no vacuous assertion.** 85 files, 710 tests, all
green on the correct stripper. The four `.not.toMatch` assertions that had been running over
mangled source (three converted in RV-203's PR, one here) were true anyway. What was missing was
never a wrong answer — it was any reason to believe the answer.

Five tests did fail during the conversion, and only one was substantive:

- **Four were self-inflicted.** Three files already declared their own `stripComments`, so the
  rewrite made it self-recursive and blew the stack; two more took the import inside a multi-line
  `import { … }` block. Both are converter bugs, fixed, not findings.
- **One was real, and it is the thing to remember.** `sleep-provisional-surfaces.test.ts` pins
  `href: "/health/sleep"` and `provisional: sleepProvisional` inside a **120-character window**, so
  a cell cannot read the flag and then not use it. The old stripper *deleted* comments; the shared
  one *blanks them to spaces*, deliberately, so line numbers survive — and the three-line comment
  already sitting between those two fields then spends the whole budget. The window was calibrated
  against a property of the broken stripper. It now collapses whitespace first, which measures what
  the guard actually means (how much **code** sits between them) rather than a byte offset.
  `oura-score-chip-row.tsx`'s own comment described the old mechanism and is corrected in place.

## The ratchet

`scripts/check-test-comment-strippers.js`, in the Custom Rules job — **`Ran 80 of 80`**. Its
baseline is **empty**, so a hand-rolled stripper in a test is a regression rather than a debt row.
It matches the five comment regexes rather than the surrounding helper, because the 88 files spelled
that helper a dozen different ways — one inlined it into a `describe` body, one named it `strip`,
one kept a function-valued replacement.

Control-run: reintroducing a stripper into `diary-groups.test.ts` **fails** it. (The first control
attempt passed, and that was my shell escaping rather than a weak check — worth recording, because
a control that silently tests nothing is the same failure class as the bug.)

The error message names the two traps the conversion hit, so the next person does not: `require` is
an eslint error under `components/**`, and a `@ts-expect-error` on the import is **unused** and
fails `check-test-typecheck`.

## Gate

Full suite **1,077 files / 10,073 tests passed**, 5 skipped · `check:rules` **Ran 80 of 80** · lint
**0 errors / 811 warnings (= main)** · tsc, test-typecheck, build, doc gates clean by exit code.

## Not exercised

No product code changed except one comment in `oura-score-chip-row.tsx`, so there is nothing to see
on the device and no version bump. Everything here is test infrastructure and a CI step.

<a id="2026-09-26-lane-b-lb161-keep-advisory-ordering"></a>

# 2026-09-26 — `lane-b/lb161-keep-advisory-ordering` (LB-161) — the advisory that argued against the entries someone got right

**Lane B · one checker fix, one field correction. No product code.**

Lane B's queue reached READY 0, so this session verified that properly rather than taking the
runner's word for it, and the verification is what found the work.

## The two advisories `check-backlog-pointers.js` prints on every run

**`BF-196` carried `Gate: device` on shipped work.** Its own fields said so —
*"shipped; only the width check is owed"* — and `Gate:` PARKS an entry, so it sat beside work that
genuinely cannot start. That is what BF-90 measured and what the advisory exists to name. Converted
to `Verify: device`, which prints in its own section. One field.

**`DV-2`'s advisory was WRONG, and that is the one worth the diff.** The rule fires when an entry
records a device outcome while its `Keep:` still asks for a check. DV-2's body opens with
`❌ FAILED ON THE S25, 2026-09-23` — but that is the **original defect report**, from the pass that
found it. The fix shipped 09-25, and the `Keep:` correctly asks for the pass test **on the fix**.
The advisory was telling the reader to strike a residue that was right.

## Why it fires, and the shape of the fix

`keepIsSettled` matched `(VERIFIED|FAILED|REPORTED BROKEN) ON THE S25` anywhere in the body. That
broadening was itself a fix (TN-13): keying on `VERIFIED` alone let an entry whose check came back
BROKEN advertise itself as finished. **The broadening created the mirror blind spot** — every entry
*found* by a device failure carries a FAILED line for ever, so every one of them reads as settled
the moment it ships a fix.

The evidence available is **position**: a shipped marker below the last outcome means the outcome
predates the fix, so nothing has looked at what is on the device now. Deliberately not a date
comparison — plenty of these lines carry no date, and a date on an outcome can be the date of the
report rather than of the look.

`SHIPPED_HERE` is narrow on purpose (`✅`/`⚠` + `FIXED|SHIPPED|LANDED`). DV-2 also contains the
prose *"ships as one fix with BF-165"*, and a loose marker would suppress the rule wherever that
sentence happened to sit.

## Mutation pass

| mutation | killed |
|---|---|
| drop the ordering guard | 2 of 23 |
| first outcome instead of last | 1 |
| broaden the marker to any `fix` | 3 |
| `>=` instead of `>` | **0 at first** |

The last one is why the pass was worth running. A single line recording *both* the fix and the look
is a real shape for a same-day entry, and `>=` would suppress the advisory on exactly the entries it
should fire for. Nothing pinned it; a case now does, and it kills the mutation.

## Both advisories are now zero

What remains is the long-standing OR-100 one — 34 `Keep:` residues that read as buildable work
rather than a check. That is a real backlog of mis-filed entries and is the Orchestrator's, not a
checker bug.

## One drive-by, stated because it is unrelated to the entry

Merging `main` brought RV-200 (#1674), which deleted the run card's explain fetch and left six dead
imports behind in `components/running/prescribed-run-card.tsx` — `useEffect`, `useState`,
`readCacheSync`, `setCached`, `todayInTz`, and a `tz` local. The repo's lint floor went 811 → 817.

Removed here rather than filed. It is a Lane B file, the deletion is six lines and carries no
behaviour, and a drifted floor costs every other session the same minute it just cost me: I had to
prove the six were not mine before I could trust the gate. `run-chip-text.test.ts` — the only suite
that reaches this card — passes, and the card's own render is unchanged.

## Not exercised

No product code changed, so there is nothing to see on the device and no version bump. Full suite
**1,077 files / 10,079 tests passed**; `check:rules` **Ran 80 of 80**; lint 0 errors / 811 warnings.

<a id="2026-09-26-lane-b-lb162-remaining-bars"></a>

# 2026-09-26 — `lane-b/lb162-remaining-bars` (LB-162) — the three bars RV-207 could not convert, and why each resisted

**Lane B · three `width` bars → `ProgressFill`. No version bump: no user-visible behaviour changes,
only how the same pixels are produced.**

RV-207 ⑤ listed six `width`-animating bars as one quick win. Three converted straight; the other
three each needed something the primitive did not have, and this is that.

## `ProgressFill` gained two props

**`origin`, as a PROP rather than a `className` passthrough.** `body-battery-card`'s track is
`flex justify-end` — the tank empties from the **left**, so the fill has to grow from the right.
`ProgressFill` hard-coded `origin-left`, and a caller passing `origin-right` through `className`
would be two `transform-origin` utilities of **equal specificity**: which one wins is decided by
the order Tailwind emits them, not by the call site. That is a coin-flip dressed as an override.

**`boxShadow`, optional.** `warmup-screen`'s bar carries a glow. `transform` scales a box-shadow
with the element, so the glow's horizontal spread now shrinks with the bar — **inherent, not an
oversight**, and at 8 px of blur on a 2 px-high bar it is not a visible difference. Recorded on the
prop so nobody "fixes" it later without knowing it was considered.

## The muscle-sets bar: clip the fill, not the track

`weekly-muscle-sets-card`'s track is `overflow-visible` **on purpose** — two `h-3` target markers
deliberately stand proud of an `h-2` track. But `ProgressFill`'s own docstring warns that an
unclipped `rounded-full` fill goes visibly oval under `scaleX`, so the naive fix (clip the track)
would have eaten the markers.

The clip moves to a wrapper around the fill alone. Both mutations — clipping the track instead, and
dropping the wrapper — fail a different assertion.

## What the warmup bar kept

`width 1s linear` ticking once a second is what made this the highest-value of the three. Both
halves survive: `durationMs={1000}` and `className="ease-linear"`, because `ProgressFill`'s default
easing is not linear and a linear tick reading as eased would be a visible change.

## Two render attempts, and neither produced evidence

The previous entry's lesson was *render it*, so I did — twice, and got nothing usable. Recording
why, because the harness is otherwise the right tool and the next person should not re-spend it:

- **Home came up on the zero-data account.** The greeting read "TrainingAI" with a `?` avatar
  rather than "Good afternoon, Test User" and **TU**, and Body Battery is absent on that account —
  so the one bar I most wanted to compare was not on screen. An earlier run in the same session,
  same config, got the seeded user, so this is non-deterministic rather than a config error.
- **The Health capture stopped above the muscle-sets card**, even at `fullPage: true`, and
  scrolling to it by text **timed out at 180 s** against `next dev`.

So: sound by construction, mutation-tested at source, and **unseen**. The `Keep:` on the entry says
so and carries a pass test rather than an assurance.

## Not done

The three `height: auto` collapses (`meal-card`, `body-battery-card`, `achievements-section`) stay
on LB-162. Each replacement changes how the open reads, which is a look decision per site rather
than a sweep.

## Gate

Full suite **10,121 passed / 87 skipped** · `check:rules` **Ran 80 of 80** · lint **0 errors / 817
warnings, equal to base** · tsc, test-typecheck, build, doc gates clean by exit code.

One thing the gate caught that a green `tsc` did not: the new spec used the regex `/s` flag, which
`tsconfig.tests.json` targets too low to allow. `check-test-typecheck` reads a different config
from the app's, so the app typecheck passing says nothing about a spec.

<a id="2026-09-26-lane-b-rv203-food-capture-local-first"></a>

# 2026-09-26 — `lane-b/rv203-food-capture-local-first` (RV-203 ① and ③) — the user's own foods, offered before the model is

**Lane B · one entry part-shipped (RV-203), two filed (LB-158, LB-159).**

RV-203 is a Review sweep-61 finding: `nutrition-scan` is the second-largest AI user at 29 calls in
30 days, and four of its call sites ask the model something the device already knows. Two of the
four shipped here. One turned out to be unbuildable in this lane and is now **LB-158**. One is a
question rather than an implementation and is now **LB-159**.

## ① Describe went to the model without looking at the user's own foods

Typing *"chicken breast"* into **Describe or enter** posted straight to `/api/nutrition/scan`, so a
food already saved with real macros was re-estimated every time — and the flow failed outright with
no network. The panel now lists matching saved foods and saved meals above the Analyse button.

**Nothing is fetched for it.** Three sources, all already present: the local store's full
`searchFoodItems` LIKE (the half that works offline and reaches past twenty rows), the
`ALL_ITEMS_KEY` list the sibling `FoodList` already seeds (the web build, which has no local
store), and the parent's `savedMeals` array. A search-as-you-type cache key would churn for no
benefit, and the one route that could serve it is already read by the list behind the panel.
`check-bare-api-fetch.js` holds this file at its existing count of 1.

**The raw text cannot be the query, and that is the part worth remembering.** `searchFoodItems` is
`name LIKE %q%`, so the entry's own example — *"200g chicken breast with white rice and broccoli"* —
matches nothing as one substring. `describe-search-phrase.ts` reduces a description to the food
name it is about: it strips a leading quantity and unit, strips "some/a/the/my", and returns `null`
for anything that names more than one food. A composite meal is not a row in `food_items`, and a
partial match for one would be worse than no match.

One bug found by its own test while writing it: the unit alternation is **not** end-anchored, so
`cup` matched before `cups` and reduced *"2 cups of oats"* to *"s of oats"*. The alternatives are
now ordered longest-first and five plural units are pinned as regression cases.

**Analyse is untouched**, which is what makes a wrong phrase cheap: it costs a list nobody taps.

## ③ "It was 300g" asked the model to redo the whole estimate

The Refine box posted the estimate back to `/api/nutrition/scan` for every correction, including
the most common one there is — the portion, which is the one thing a photograph cannot tell the
model. The Review sheet's serving-size field already rescales every macro from a base snapshot, so
*"it was 300g"* has an exact local answer; asking the model produced a *different* one for no
reason, cost a round trip, and failed with no network.

`portion-correction.ts` is deliberately timid, and **the asymmetry is the whole design**: a miss
costs one model call, which is exactly today's behaviour, while a false positive silently rescales
the user's macros with nothing on screen to say the model was skipped. So it refuses unit-less
numbers, millilitres (grams are what the row stores, and ml→g is a density this app does not know),
and anything with a second clause — *"it was chicken thigh not breast"*, *"300g and it was fried"*
and *"double it"* all still go to the model. An estimate that arrived with no serving size has no
base to scale from, so it asks the model too.

Mutation-tested: dropping the gram ceiling and making the unit optional each break a different
assertion.

## The e2e guard, and what it deliberately cannot see

`e2e/rv203-describe-offers-your-own-foods.spec.ts` asserts the negative that is the entry's "done
when": the panel reaches the assign step with **no `/api/nutrition/scan` request at all**, counted
for the whole test. A second case is the control — a description naming two foods must offer
nothing — because without it a suggestion list that never rendered would pass the first test by
never offering anything, and "no scan" would be evidence of nothing. **Control run with
`describeSearchPhrase` stubbed to return null: fails.**

It opens the **Search** tab before Describe, and that is not stage-setting. On the web
`getLocalStore` returns null, so the only reachable source is the `ALL_ITEMS_KEY` list that
`FoodList` seeds — and the sheet opens on *Recent*, which does not seed it. **So the harness
exercises the fallback and cannot touch the source that matters.** On the device the local store
answers cold and offline; that is the `Keep:` on the entry, not something a green run here
substitutes for.

## ② Barcode — blocked, and the entry did not know why

RV-203 ② asks for "look up the user's saved foods by barcode first". There is nothing local to look
it up in: `food_items.barcode` exists on the server (`schema.ts:691`) and **nowhere on the device**
— not in `CREATE_FOOD_ITEMS`, not on `LocalFoodItem`, not in `foodItemRowToItem`, so the pull delta
drops it silently. That is a local SQLite version bump, which is Lane A's alone. Filed as
**LB-158**; the Lane B half afterwards is three lines at `handleBarcode`.

## ④ Meal plans — a question, not an implementation

RV-203 ④ wants `useLibrary` defaulted on. That changes what every generated plan contains, and the
off-by-default was a written choice rather than an oversight (BF-11h, 2026-08-27: *"on changes what
every generation returns, so it is the user's call rather than a new default"*). Filed as
**LB-159**, `Lane: O`, with the recommendation attached — default on when the library is non-empty,
off when it is empty — and the alternative's genuine upside stated: an invented plan is where new
meals come from.

## A guard that was reading half a file

Switching `capture-actions.tsx`'s comments broke `rv111-scanner-back-dismiss.test.ts`, and the
cause was not the change. **37 source-scan tests copy the same regex comment stripper, and it
treats the `/` + `*` inside `accept="image/*"` as a comment opener**, deleting everything to the
next closer — the exact LA-64 defect `scripts/lib/strip-comments.js` exists to prevent. Measured:
11 source files carry the trigger, 4 test→file pairs read one, and the loss runs from 25% to 56%
of the file. `food-image-write-paths.test.ts` held **two `.not.toMatch` assertions over a source
with 56% of its bytes gone** — the vacuous direction, which a guard cannot report. Re-run against
the correct stripper they still pass, so nothing was hiding; what was missing was any reason to
believe that.

Five files now use the shared stripper. The remaining 34 are `LB-160`, along with the question of
whether a Custom Rules step should hold it — prose did not, and the population regrew to 37.

## Not exercised

- **The offline half of ① is unverified here.** `getLocalStore` returns null in the sandbox and in
  vitest, so the suggestion list's local-store branch never ran; what ran was the seeded-cache
  branch. There is no DOM project in this suite either, so the wiring is held by source assertions
  (`rv203-local-first-capture.test.ts`) rather than by rendering.
- Native SQLite, Samsung WebView, safe-area insets and drifted production data: untouched.
- **Device pass test**, recorded on the entry: on the S25 in airplane mode, Log Food → Describe →
  type the name of a food logged before → it appears under *"You already have"*, and tapping it
  reaches the assign step.

<a id="2026-09-26-lane-b-rv207-design-quick-wins"></a>

# 2026-09-26 — `lane-b/rv207-design-quick-wins` (RV-207) — five of seven were quick wins; two were not

**Lane B · v1.465.67 · one entry shipped in part, two filed (LB-162, LB-163).**

RV-207 is Review sweep 63's design pass: seven small defects, filed as one PR "because every item
is small and code-certain". Five were. **Two were not, and saying so is most of what this entry
adds** — the sweep read them at source, which is enough to find a defect and not enough to see what
fixing it would look like.

## Shipped

**① Initials took the first two letters.** "Test User" rendered **TE** and "Zero Data" **ZE**.
One `initialsOf()` in `lib/initials.ts`, used by all three sites — first letter of the
first and last words, falling back to two letters for a single word, which is the only case the old
code got right. Twelve cases, including the email fallback two of the three sites use.

**② "3 sets · 1 exercises".** Pluralised — **and `sets` too**, one line above, which the entry did
not name and has the identical defect.

**③ A second supplement tick was silently dropped.** `toggleLog` opened with `if (toggling) return`
against a `string | null`, so a guard written to stop a double-tap on ONE row applied to the whole
screen: ticking B while A's write was in flight did nothing, with no error and no visual change.
Now a `Set` of in-flight ids, guarded per id in all four places that state is read or written.
Mutation-tested three ways.

**④ Press feedback on the daily controls** — the tab bar (both shapes), More rows, Nutrition's date
chevrons and settings, pre-workout back, the Home avatar, Health's three Log pills, the supplement
row. Matched to `components/ui/button.tsx`'s existing pattern rather than inventing one, **including
its `motion-reduce:` guards**, which my first pass omitted. `hover:` is removed where it was the
defect: on the WebView it sticks after a tap, which is what the entry reported.

**⑤ (part) Three of six `width` bars** → the existing `ProgressFill` (scaleX): `goal-progress-bar`,
`metric-tiles-card`, Health's water bar.

**⑦ "13.0T" read as thirteen trillion.** Uppercase `T` is the SI symbol for the **tesla**; `kT` was
a kilotesla. Now `13.0 t` / `13.0 kt` / `250 kg`, with the space that makes it a unit rather than a
suffix. The entry also offered `13,000 kg` to match Health — **not taken**: Health shows a period
total and this is lifetime volume, which reaches seven digits.

## Not shipped, and why — the part worth reading

**⑤'s other three bars are not mechanical, each for a different reason** (LB-162):

| bar | why `ProgressFill` does not fit |
|---|---|
| `warmup-screen` | gradient + a `boxShadow` glow; **`scaleX` scales a box-shadow**, so the glow shrinks with the bar |
| `weekly-muscle-sets-card` | track is `overflow-visible` **on purpose** — an `h-3` target marker deliberately overflows an `h-2` track, and clipping it to stop the fill going oval would clip the marker |
| `body-battery-card` | track is `flex justify-end` so the tank empties from the LEFT; `ProgressFill` is hard-coded `origin-left`, and `className="origin-right"` is a same-specificity collision decided by stylesheet order |

**Two of ⑤'s six paths were wrong** — `goal-progress-bar` and `weekly-muscle-sets-card` are under
`components/health/`. Corrected on LB-162.

**⑥ is an owner decision, not a defect fix** (LB-163). Moving Home's Log label and putting the
tiles on a fixed three-column grid is a visible rearrangement of a daily screen, which CLAUDE.md
gates on a mockup at 384 px and a yes. Three columns fixes the ragged row *and* makes each tile
narrower — a trade, not a strict improvement.

**It is filed `Lane: O` with NO `Gate: owner`, deliberately.** The mockup does not exist yet, so the
next act is to produce one and put it to him — that is work, and work is ungated. A gate would park
the entry and nobody would be tasked with asking. `check-backlog-pointers` caught my first attempt
(the field was inline and would have been ignored), which is what prompted getting this right.

## A guard that broke on a legitimate refactor

`rv68-supplement-tick-paints-first.test.ts` pinned `indexOf('setToggling(null)')` — a **literal**,
not the property. Making the guard per-id broke it while the property it exists for (released in a
`finally`, after the optimistic paint) was true throughout. It now matches any release that is not
the add, and a control run — moving the release out of the `finally` — still fails it, so it was
corrected rather than weakened.

## Gate

Full suite **1,080 files / 10,102 tests passed** · `check:rules` **Ran 80 of 80** · lint **0 errors
/ 817 warnings, equal to the base** (the base is 817 too; that drift arrived with other sessions'
merges, not this branch) · tsc, test-typecheck, build, doc gates clean by exit code.

## Rendered, after this entry first said it had not been

The version of this entry that shipped in #1693 said *"everything visual here is unverified"*. That
was true of the diff and did not have to stay true: the Playwright harness drives the real app at
the 412 px dark viewport, and a design entry is exactly what it is for. Three of four surfaces
captured — Health times out at 45 s in `next dev` and wants a longer budget.

**Seen on screen, not merely asserted:** the avatar reads **TU** on both Home and More, where it
read TE; lifetime volume reads **13.0 t**; Nutrition's date chevrons and settings gear render
unchanged after the className rewrites; the three converted bars draw at the right width.

**It also reproduced RV-207 ⑥,** which was read at source when filed: the word "Log" is drawn
directly over each tile's icon and is barely readable against it, and the three tiles occupy about
**58% of the row**. That is now on LB-163, so the mockup starts from an observation rather than a
description.

## Not exercised

**A screenshot is not a press.** `active:` states need a real touch and the S25's WebView — the
harness cannot show the stuck-`hover:` behaviour that prompted ④, because that is a device
behaviour, and the `motion-reduce:` branches are unexercised. **RV-207's own "done when" —
RV-205's P24 re-run showing a first-frame change under 100 ms on the tab bar and More rows — has
NOT been run**, and needs the device. Nothing here ran on the APK.

<a id="2026-09-26-lb158-local-barcode"></a>

# LB-158 — the barcode column existed everywhere and held nothing

**Branch:** `feat/lb158-local-barcode` · **Lane A** · no Postgres migration · local SQLite **v41**

## What the entry said, and what was actually true

LB-158 was filed by Lane B while splitting RV-203 ②, and it reads as a mirroring problem:
`food_items.barcode` "exists on the server and **nowhere on the device**", so the pull delta drops
it silently and an offline re-scan has nothing to look up in. Every one of those statements about
the device is correct.

The premise underneath them is not. One query against production before writing any code:

```
source   | rows | with_barcode
---------+------+-------------
ai       |  289 |            0
barcode  |   42 |            0
text     |   10 |            0
```

**341 rows, zero barcodes — including all 42 whose `source` is literally `'barcode'`.** Nothing
was being dropped on the way to the device, because nothing was ever written. Mirroring the column
as filed would have mirrored nulls, shipped a `getFoodItemByBarcode` that could only ever return
null, and closed the entry.

The gap was one step earlier and it is almost comic in how complete the *rest* of the chain is:

- `food_items.barcode` — the column, since it was added.
- `FoodItemSchema.barcode` — the Zod validator.
- `rowToFoodItem` — the server read mapper.
- `POST /api/nutrition/food-items` — passes `body.barcode` straight through.
- `pushMutations`' food_items branch — reads `p.barcode`, **and Q-131 fixed that line specifically**
  because "the same item saved offline lost its barcode".

…and `NewFoodItem` had no `barcode` field at all, so `createFoodItem` never set one and the outbox
payload never carried one. Q-131 repaired the half it could see against a field no client sent.

## What shipped

**The write half** (this is the part that makes the column non-empty):

- `NutritionScanResult.barcode`, echoed by `/api/nutrition/barcode` from the code it was given —
  the same reasoning as BF-70's `origin` beside it: the caller builds a row several steps later and
  nothing else on the response says *which* product this is.
- `NewFoodItem.barcode` → `createFoodItem`'s item, its local write, and its outbox payload.
- `NewFoodEntry.barcode` → `logFoodEntries`' local mirror and its queued mutation.
- `food-logger-sheet.tsx` reads it off the scan result; `ingredient-picker.tsx` passes the code it
  already held.

**The device mirror:** local SQLite **v41** (`ALTER TABLE food_items ADD COLUMN barcode TEXT`, plus
the `CREATE_FOOD_ITEMS` body and a `RECONCILE_COLUMNS` row — the three-part rule BF-39 keeps
earning), `LocalFoodItem.barcode`, the upsert, `foodItemRowToItem`, the pull delta's `foodItemCols`,
the sync-engine mapping, and `toLocalFoodItems` in `food-log-hydration.ts` — a **second** hydration
surface onto the same table, which is exactly the shape BF-72's missing `savedMealId` took.

**The read:** `store.getFoodItemByBarcode(code)`, and one shared
`lookupBarcode(code, userId)` that both scanners now call instead of fetching the route directly.

## Two decisions worth not re-litigating

**The local upsert COALESCEs `barcode`, and it is the only column here that does.** A code is known
*only* at the scan; every other write to that same id offers null — logging the food again from
Recent, a saved meal containing it, a hydrate from a payload without the column. Under
`barcode=excluded.barcode` the first of those wipes it, and the feature is dead on the second scan.
A product's code does not change, so there is no legitimate update this drops. It is a mutation
target and killing it fails a test.

**The Lane B footprint is deliberate and small.** The path rule sends a both-halves entry to Lane A
engine-first, and the engine half alone would have been unobservable here: a column nothing writes
and a lookup nothing calls. So the shared helper carries the logic (Lane A) and the components
changed by a line each — two `barcode:` passes and two `fetch` → `lookupBarcode` swaps.

## What two shrink-only ratchets caught, and why the first number was wrong

The full suite failed two files, both correctly.

`check-bare-api-fetch.js` asked to lower `capture-actions.tsx` 1→0 and `ingredient-picker.tsx` 2→1.
**That reading was flattering and wrong**: it enumerates via `git ls-files`, and the new helper was
still untracked, so its own bare GET was invisible. Staged first, the honest picture is two sites
collapsing into one — **net −1, not −2** — and `barcode-lookup.ts` carries a baseline row of its
own. It is baselined rather than exempt: a barcode→product mapping is genuinely cacheable, so there
is no "must not be cached" claim to make.

`rv203-local-first-capture.test.ts` pinned `capture-actions.tsx` at exactly two `/api/` calls. It is
one now — the file went *further* local-first than RV-203 asked, rather than losing a read — so the
assertion is updated to 1 plus the negative that the barcode URL is gone from it.

## Verification

Full suite **10,314 passed / 87 skipped**; lint 0 errors and 796 warnings, identical to `main`;
`check-test-typecheck` at baseline (317/88); Custom Rules **80 of 80**.

15 tests across three files. Mutation pass, 5 real mutants + 1 control:

| mutation | killed |
|---|---|
| `barcode=excluded.barcode` instead of COALESCE | 1 |
| `createFoodItem` drops it from the outbox payload | 1 |
| `lookupBarcode` skips the library | 1 |
| a 500 reports as `notFound` | 1 |
| the route stops echoing `validCode` | 1 |
| **control:** name the code in a local const first | **0 — survived, as intended** |

On the dev server: a food item created with a barcode lands in the column (`9300601000876`), the
same item pushed through `/api/sync/push` as an offline mutation lands too (`9310072021234`), and
`/api/sync/pull` returns the code in its `foodItems` delta. Both were verified against the local
Postgres rather than inferred from the response.

## Not exercised

**The library-first read itself, end to end.** `getLocalStore` returns null in the sandbox — native
SQLite does not run here — so the local hit is covered by unit tests with a fake store and by the
mutation that kills it, never by a real device read. This is the offline-first rule's own step 5.

**Open Food Facts is unreachable from this container** (`/api/nutrition/barcode` returns
`{"unavailable":true}`), so the route's echo of the code is proved by its unit test rather than by a
live lookup.

**No device, and nothing scanned.** A real camera has never handed a code to this path.

<a id="2026-09-26-or-174-head-start-correction"></a>

# The four "head start" branches were stale, and the rule that found them needed one more step

Filed and corrected the same day. `OR-174` claimed four surviving branches held unmerged work for
still-queued entries and recommended draft PRs for each. **Diffed against `main` afterwards, not one
holds anything worth keeping.**

| branch | what the diff shows |
|---|---|
| `chore/or-127-device-cdp-harness` | **Superseded.** All five harness files are on `main`, and `main` is ahead — `scripts/device/README.md` is **+13 −208**. |
| `lane-a/rv99-score-band-theme-tokens` | **Landed.** `score-band.ts`, its test, `accent-card-style.test.ts`, `utils.ts` all **byte-identical** to `main`. |
| `lane-a/q44-phase3-pr1-table-rename` | **Unmergeable.** Adds migrations **273/274**; `main` already has both under different names. `ensureSchema` tracks by filename. |
| `lane-a/fix-gate-pin-q305` | One test file, **+10 −10**. Trivial. |

## What went wrong, precisely

The audit asked *"does this branch's name match an open entry?"* and treated yes as evidence of a
head start. **It is not.** An entry stays open for reasons that have nothing to do with its branch —
`OR-127`'s harness **shipped weeks ago**; the entry is open for the **on-device run it still owes**,
which no branch can supply.

Reasoning from the queue to the code inverts the direction of evidence. The queue records what is
*wanted*; only the diff records what *exists*.

## The rule as it should have been written

Matching a live entry is **necessary but not sufficient**. Three questions against `main`, in order:

1. Is the file on `main` at all?
2. Is it identical?
3. Is `main` **ahead**?

A branch whose name matches a live entry and whose content `main` has moved past is the **worst**
kind to keep — it is the one a later session is most likely to "restore" from, reintroducing older
code under a name that looks authoritative.

## Why this was worth catching now rather than at the sweep

The device agent is about to run a sitting and **`OR-127` is rank 1 in its lane**. Left uncorrected,
the entry told the next reader there was a 12-file, 7-commit head start sitting on a branch. Acting
on that means reading superseded code, or worse, restoring it over a `main` that is 208 lines
further on.

## Net effect on the sweep

**All four move from "keep, open a draft PR" to "sweep".** The branch-meaning rule itself is
unchanged and was vindicated — the audit it demands is exactly what surfaced this. What changed is
the depth that audit has to go to.

<a id="2026-09-26-or-175-route-sweep-4a"></a>

# Routing device sweep 4a — six entries out of the device lane, one closed

Sitting 4a (#1696) closed **ten** entries as verified and left eleven needing a decision. This is
the routing pass. **No device time and no product code** — it moves work to the lane that can do it.

## The failure mode this prevents

Seven entries sat in `Lane: DV` that the sitting had **already answered**. Left alone, the next
sitting re-picks them — the trap CLAUDE.md names as *"a probe that has already been run is no longer
DV's"*. An answered probe is not device work; it is whatever the answer implies.

## Re-laned off `DV`

| entry | now | why |
|---|---|---|
| `RV-186` | **A** | ②③⑤ FAILED, so what is left is code. ⑤ (`hr-profile`/`zone-minutes` 430–610 ms) is route latency = A; ②③ (4 requests per resume, 24 on a Health switch) are client counts = B. Reaching both means **A first**, per the path rule. |
| `OR-162` | **B** | Sweep 4a **named the cause** it existed to find: two *HEART RATE · TODAY* charts re-measure on every switch **while hidden**. `components/**`. |
| `RV-153` | **B** | Answered: **~120k characters of `localStorage` rewritten per Home tap**, friends-feed 459k. Stores and hooks. |
| `RV-150` | **B** | Answered: a failed refetch is invisible. This is the `Q-499` shape — `cachedFetch` swallows `!res.ok` without `onError` — so the fix is at the call sites. |
| `DV-8` | **A** | **Second independent reproduction** (food delete pending, both outboxes empty). Two is enough; more device time would be re-running an answered probe. |
| `Q-300` | **A** | See below — it had **no lane field at all**. |

## `Q-300` was invisible to every implementer

It carried **no `Lane:` field**, so `next-item.js` printed it as UNCLASSIFIED and nobody could pick
it up. Sweep 4a discharged the one thing it owed: with `/api/health-trends*` blocked the *Rest
discipline* card showed *"Couldn't load this trend"*, proving it renders from the **server route**
rather than `getLocalStore`. What remains is the RPE model gaining a rest term — domain math in
`packages/shared/**`, so **Lane A**.

## `DV-12` is a pass test, not a task

Annotated rather than re-laned. It stays `B`, but it is now explicit that **`OR-162` and `RV-153`
hold the fixes** and this entry is where the result gets re-measured. Starting it as work would
duplicate both.

## `Q-11` closed — the backfill ran and found nothing

Its `Keep:` was *"the one-off backfill over pre-fix sessions"*. Owner-approved and run in 4a:
**33 sessions processed, 0 had HR data, nothing filled**, production under 0.55 s throughout.

The owed action is discharged, so the entry leaves the queue. **The durable fact is that those
sessions can never gain per-set HR attribution** — the underlying data is gone, so this is a
permanent state rather than outstanding work. It is recorded in the sweep-4a journal.

## Left where it is

`RV-132` stays `DV`, correctly: sweep 4a found the link census is **nearly empty by construction**
(only one `<a href>` route is reachable from the tab roots — Home → `/coach`), so the real census is
tap-by-tap over buttons with a write-safe allowlist. That still needs the phone.

`RV-205` stays `DV` — tier 1 done, further tiers owed.

## Still failing, and now owned

`DV-12`, `BF-61` ①, and `RV-186` ②③⑤ are FAILED results. Per the standing rule a **FAILED is work,
not verification debt** — each is now in the lane that owns its surface rather than sitting as a
device gate that reads as finished.

<a id="2026-09-26-or-176-route-sweep-4b"></a>

# Route device sweep 4b: a dead notification channel, and a scrim that stops at the tab shell

Orchestrator, 2026-09-26. Docs only. Device Verification's sitting 4b (#1701) closed five entries
itself; this routes what it could not.

## The find worth naming

Station A of `RV-155` reported row 11584 as FAILED: the S25 has no `health-alerts` notification
channel, only `oura-ble-v2`. Read at source the same day, that is not a device quirk —
`components/capacitor-native-init.tsx` creates exactly five channels and `health-alerts` is not one
of them, while `lib/health-alerts.ts:121` schedules with `channelId: HEALTH_ALERTS_CHANNEL`. On
Android 8+ a post to a channel that does not exist is dropped.

So illness, high-stress and low-readiness alerts have never been able to fire. Every layer above the
channel is healthy — `reconcileHealthAlerts` runs from the sync provider, `computeHealthAlertActions`
is unit-tested and green, the dedup key is written. **The only surface that shows the fault is the
device's channel list**, which is why a green suite and a working feature look identical here. Filed
`DV-21`, Lane B, rank 1.

## Routed

| from 4b | where it went |
|---|---|
| no `health-alerts` channel (RV-155 row 11584) | **`DV-21`** new, Lane B, rank 1 |
| pushed routes have no status-bar scrim | **`DV-22`** new, Lane B |
| RV-206 P29–P31 need the owner's OK | **`OR-176`** new, Lane O, `Ask: owner` |
| 36 stuck food-delete tombstones | `DV-8` re-scoped and retitled, stays Lane A |
| PS-35b launch half passes | `Verify:` narrowed to the one half still owed |

## Three things this got wrong on the way, and the one worth keeping

**`Verify:` on unbuilt work.** Both new entries were written with `Verify: device` for the check they
will owe once built. `Verify:` means SHIPPED, so `next-item.js` filed them under KEEP — *done, a look
is owed* — and `DV-21` did not appear in Lane B's READY list at all. CLAUDE.md names this exact trap
and it was still walked into, because the field reads like a natural place to put a device check. The
fix is prose, and both entries now say outright why it is prose.

**`DV-6` is not reopened.** The pushed-route scrim is the same defect on a surface DV-6's fix never
reached: it is mounted once in `tab-shell.tsx`, which covers the five tab panels and nothing pushed
on top of them. The fix was scoped narrower than the defect — nothing regressed, so `DV-6` keeps its
shipped status and `DV-22` carries the gap.

**`DV-8` was not promoted, only retitled.** Thirty-six stuck rows over fourteen days is a live defect
rather than the curiosity its title described. It still sits below Lane A's auth work, because
nothing is lost — the server applied every one of these — and the cost is unbounded `pending` rows
and a status column that lies.

## Not done

Station A's VERIFIED rows are owed to `RV-156`: their `projectOverview.md` Known-Issues rows should
move to the archive, and have not. Until that happens the list overstates what is unverified, which
is the drift `RV-155` exists to fix. Recorded on `RV-155` rather than left implicit.

<a id="2026-09-26-or-177-lane-audit"></a>

# A lane audit, and the one entry whose own title said it was open work

Orchestrator, 2026-09-26. Docs only. Prompted by the owner: *"check what items can be done by DV and
make sure everything is assigned to the correct lanes."*

## What changed

**`BF-61` is reopened as Lane B work and promoted to rank 3.** The v1.465.62 fix shipped, so the
entry carried `Verify: device` and a `Keep:` — which put it in Lane B's VERIFY list, *shipped, a look
is owed* — while its own title read *"the fix FAILED on the device; open work"*. A FAILED device
result is work for the lane that owns the surface, not a check still owed. That rule is in CLAUDE.md
and this entry is what it was written for.

Sweep 4a turned it into a bug with a number, which is what makes it buildable now: from a
verified-closed tray, a tap on Delete's own rect at **0 / 100 / 200 / 300 ms is swallowed (8 of 8)**
and at **500 ms works (2 of 2)**. A human immediate tap is ~150–300 ms. The v1.465.62 fix moved the
`z-10` raise to the start of the journey and the window survived it, so the `isOpen` gate is not the
whole cause.

**`Q-538` carried two lane fields that disagreed** — `Lane: A` for the prune caller, and a stale
`Lane B` describing the admin console-visibility half, which has since shipped. First-match-wins meant
nothing was mis-served, but the pair is exactly what `lane.js` warns a duplicate creates. The second
is demoted to prose.

**`RV-206` records the owner's standing approval** for the three phone-settings probes, and `OR-176`
is removed as answered.

## The audit, and a scan that was wrong

A regex over the file said **32 entries have no lane field**. Run through the repo's own parser, the
real number is **2** — `BF-11`, a `Reference:` spec pointer that needs no lane, and `PS-4`, which is
`Lane: ?` deliberately with a prior sweep's attempt to classify it recorded and reverted. The scan
missed the bare form (`— Lane A`, `**Lane B**`), which 75 of the entries use and which `lane.js`
reads on purpose.

**Reasoning from my own grep instead of from the tool that owns the question is the same error that
produced `OR-174`.** One `parseEntries` call settled it. Lane assignment across 526 entries: A 306,
B 117, O 77, DV 24, unresolved 2 — and both of those are deliberate.

## What DV can actually do next

The `Lane: DV` list is 24 entries and it is sound. Three earlier proposals to re-lane entries away
from the device agent (`TN-62`, `RV-169`, `Q-168`) were declined with reasons recorded on each, and
those reasons still hold — the admin-sitting entries are DV's because DV runs on the owner's machine
holding his signed-in session, not because the phone is involved. `--sittings` reports **109 device
checks owed** across all lanes plus **10 entries blocked on one**, grouped by domain; that grouping,
not the DV lane alone, is what a sitting is built from.

<a id="2026-09-26-or-178-tuning-lane"></a>

# Tuning gets a lane, and two of the three guaranteed-conflict files stop existing

Orchestrator, 2026-09-26. `scripts/` tooling plus docs. Owner asked for the `O` lane to be cleared
and everything routed correctly.

## `Lane: T`, because a correct triage could not act on itself

Fifteen scoring entries owed a **Tuning proposal**, not the owner's signature. Three independent
sweeps (OR-117 on 09-16, OR-153 on 09-24, RV-189 after) each reached that conclusion, and none of
them could record it. Removing the wrong `Gate: owner` would have released the entries into Lane A's
READY list — and a scoring change with no proposal is exactly what Lane A must not pick up. So the
wrong field was also the only brake within reach.

The workaround was `Needs: OR-150` on all fifteen: a dependency on an entry whose whole content was
*"these need a lane that does not exist"*. It parked them for the right reason while stating a false
one.

`T` is now a lane value. `lane.js` matches it, `next-item.js` treats it as assigned-only (like `O`
and `DV`, so it never inherits the untagged), and `docs/agents/README.md` carries it in the table.
**A `T` entry names its implementation lane in prose** and Tuning re-lanes it to `A` or `B` when the
proposal exists — the lane keeps meaning *who acts next*.

`node scripts/next-item.js --lane T` prints **12 ready, 3 parked**. `OR-150` is removed: its
deliverable is now visible as the lane emptying, and each entry carries its own reason.

OR-150 itself deferred this — *"revisit only if these fifteen prove that a standing channel is needed
rather than one entry"*. Fifteen entries across three sweeps is that proof, and the deferral was
right to want it first.

## `docs/doc-size-baseline-history.md` stops being written by finishing PRs

LB-120 measured the three files that collide on every pair of concurrent PRs, the same three every
time across six resolve-and-push cycles on #1333. **Two are now gone:** the backlog's own `.size`
baseline (LA-129 reports rather than ratchets it), and this one — LB-130's fix, one note per change
under `docs/doc-size/history/`, the shape `docs/overview/entries/` already uses. The three reminder
messages in `check-doc-index-size.js` point there now; the 18,000-line batched file keeps every older
note and a compaction sweep folds the new ones in.

**The third is `docs/implementation-backlog.md` itself and it is irreducible** — two agents removing
two finished entries is a genuine concurrent edit, not an artefact of file layout. LB-120 is annotated
to say so: anything further proposed there needs a fresh measurement, because the cause it argued
from has been removed twice over.

This PR's own baseline raise (`CLAUDE.md` 1054 → 1056) wrote the first note under the new directory,
which is the cheapest possible proof the convention works.

## Cleared, and one thing found

- **`LB-134` removed** — closed by OR-164 on 09-25 with no residue, and still sitting in the queue.
- **`RV-143`'s tooling half is done** and now says so. `--sittings` consults the device gate and
  prints **BLOCKED ON A DEVICE CHECK (10)** ahead of the 109 owed looks. Only the triage is left.
- **`OR-139` gained its sixth instance**, and it is the best evidence it has: `BF-61` shipped a fix,
  the fix failed on the device, and the entry kept `Verify:` + `Keep:` — printing to Lane B as *not
  new work* while its own heading read *"the fix FAILED; open work"*. The entry contradicted itself
  in one screenful and the runner believed the field. Six hand-fixes is enough; the entry now names a
  narrow check that would have caught all six, keying on the three words the device protocol allows.

## Lane O after this

44 ready, 16 waiting on the owner — from 47 and 16. The reduction is small on purpose: most of what
is left is genuine Orchestrator work (docs reconciliation sweeps), not mis-routing. The routing was
already close to right; what was wrong was that Tuning had nowhere to be sent.

## Four owner decisions taken the same day

Put to him as one prompt, with a recommendation each. All four answered; entries re-laned and out of
`O`.

| entry | answer | now |
|---|---|---|
| `LB-141` walk exits | **Prompt on both** — he overrode the recommended silent save | Lane B |
| `LB-152` colour tokens | **Retune the token to today's hex first, then migrate** | Lane B |
| `LB-157` Home header | **Date on its own line**; battery chips stay, deliberately | Lane B |
| `BF-191` phantom rows | **DV may soft-delete the three named ids** next sitting | Lane DV |

Two are worth recording in more than a table. **`LB-141` went against the recommendation** — the
brief argued for a silent save on the ground that a wrong save costs one tap and a wrong discard is
permanent; he took the prompt anyway, so the entry says build the prompt and not to re-derive the
asymmetry argument. **`LB-157` closed an alternative as well as choosing one:** moving the battery
chips off Home was offered and declined, because he added them on purpose (Q-111), so that option is
struck rather than left open for the next reader to re-propose.

`BF-191`'s authorisation is for **three named row ids and nothing else** — a one-off, not a widening
of the device agent's standing write permissions.

Lane O's owner queue: **16 → 12**.

<a id="2026-09-26-or-180-rv156-archive-test"></a>

# The archive list was wrong: eleven rows, eleven still owing something

Orchestrator, 2026-09-26. Docs only. `RV-156` said about 30 Known-Issues rows are already answered
and should move to the archive. Its §4 named the rows. I tested them instead of moving them.

## All eleven failed the archive rule

The rule is *move a Known Issue only when nothing is still owed* — no open work, no pending owner or
device check, no un-run follow-up. Checked one at a time against the row's own text and the queue:

- **`Q-556` describes a live defect.** `DELETE /api/activity-logs` answers `200 {"success":true}` for
  another user's row. Not a leak — the row survives, still theirs — but the handler cannot know,
  because the repo method returns `void`. Archiving that is burying it.
- **`Q-461` is still in the queue**, and it shares one heading with `Q-460` and `Q-462`. Moving the
  row would have taken live work with it.
- **`LB-107` rests on an uncorroborated claim.** The sweep says *"verified in sweep 1"*; no journal,
  entry or sweep record says so, and the row itself says the gesture is owed on the S25 and reachable
  nowhere else. Absence of evidence is the answer here, not a technicality — the check is cheap and
  nobody has recorded running it.
- The other eight each carry an owed device check, an open 🟠, or an unverified probe.

## Why a careful sweep produced a wrong list

Sweep 55 read about 30 rows quickly and judged *"is this answered somewhere?"*. The archive rule asks
a different question: *is anything still owed?* **A row can be entirely correct that its fix shipped
and still owe a device check** — and eleven of eleven here do. The two questions agree often enough
that the difference is invisible until you test for it.

`RV-156` now carries the table and says outright not to apply its own §4 list. The movers have to be
re-derived from the rows.

## The amend half is sound, and two are done

`LB-4` was recorded as 🟠 open in the calorie-surface row although it had shipped and left the queue —
and **the identical paragraph was pasted into the `LB-1` row**, describing a different heading's work.
The paste is gone; the surviving bullet says shipped and says it was corrected.

Still owed on that half: the two *"ALL QUEUED (fixes not yet shipped)"* headings, `gps-watchdog`'s
*"until it ships"*, the sheet that no longer renders the list, the APK claim, the pulls-never-revert
claim `DV-15` disproved, and the route that moved out of Admin.

## Not done

Nothing moved to the archive. That is the result, not a shortfall — `projectOverview.md` is what every
session reads before it can start, and a row that hides an open defect there is worse than a long list.
