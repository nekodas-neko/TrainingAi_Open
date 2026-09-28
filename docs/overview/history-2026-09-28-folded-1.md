# Session journal — batch folded 2026-09-28

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-27-bugfix-bf-213-1608-renumbered"></a>

# 2026-09-27 — the daily inbound watch's first run: the contributor fixed his own collision (BF-213)

First firing of the daily inbound GitHub sweep (OR-185). Scope is issues and PRs we did not author.

## The sweep

- **Open issues: 0.** `#1620` has been closed.
- **Open PRs: 19, of which 2 are not ours** — `#1607` and `#1608`, both `jsboiss`. Both already
  carry backlog entries (`BF-212`, `BF-213`), so nothing was unfiled.

## `#1608` moved, and `BF-213` was left describing a defect that no longer exists

He renumbered from **288/289 to 290/291** and regenerated the `claude_ro` twin **after** applying —
which is the ordering that matters, and it shows: the regenerated file carries
`training_load_grid_len` and `training_load_valid_min`, so it was produced against a database
holding LA-161 rather than a stale one.

Verified with the tool that owns the question rather than by reading the diff:
`node scripts/next-schema-number.js` reports **292** next free, lists 290/291 as claimed by
`origin/health-sample-storage` alone, and reports no collision. CI is **all ten jobs completed and
success** on head `0bb5a87e`, Migration Check included.

`BF-213` still said the PR collides at 288/289 and that its twin would be silently dropped. Left
alone, Review would have re-raised a resolved problem with a contributor who had already fixed it.
The entry is now the routing record for what is genuinely still owed — Review's diff read, the
owner's merge.

**That tool is itself the answer to `#1620`.** It reads every branch rather than `main`, which is
exactly what the issue asked for and what `BF-211` recommended; it is what made this verification a
single command.

## One finding that is ours, not his

`next-schema-number.js` reports a **real** collision on **273/274** — claimed by both `main`
(merged, `273_exercise_media_review_status.sql`) and `origin/lane-a/q44-phase3-pr1-table-rename`.
That branch must renumber before it can land. Recorded on `BF-213` so it is not lost; not this
entry's work.

## `#1607` unchanged

Head is still `6f6fd763`, and its CI is still the **2026-09-25** run — six jobs with a single
`Tests`, from before the suite was sharded. `BF-212` already says so and needs no change.

## Not exercised

Docs-only. Nothing built, nothing run on the device, and **nothing merged, closed or pushed on
either inbound PR** — the ceiling there is review, comment, approve.

<a id="2026-09-27-docs-four-screen-mockups"></a>

# 2026-09-27 — four mockups in one sitting, saved to the repo rather than shown in a chat

**Branch:** `docs/four-screen-mockups` · Orchestrator

Four approved-in-principle changes each owed a before/after before any code: `LB-163` (Home's Log
tiles), `LA-136` (Home's sleep line), `RV-213` (Nutrition's empty meal slots) and `RV-166` (merging
walk and run in the cardio hub). The owner asked for them in one sitting, which is also the rule —
splitting them means the same screens get judged three times.

[`docs/design/2026-09-27-four-screen-mockups.html`](../design/2026-09-27-four-screen-mockups.html) ·
[hosted](https://claude.ai/artifact/U4aypd5Un44whR6exTjWqX)

## Built from source, not from imagination

Each **before** is a recreation from the actual component, at the real 384 px dark viewport, using
the dark tokens copied out of `app/globals.css` rather than approximated:

- **`LB-163`** — the `Log` pill really is `absolute top-0.5 right-0.5` with `min-h-11`
  (`metric-tiles-card.tsx:99`), which is why a 44 px target lands on a 16 px icon; and the tiles are
  a `flex` row, not a grid, which is why three of them leave the right third empty.
- **`LA-136`** — the fabricated line is gone and nothing replaced it; `sleepQualityFeel` is
  collected and unread.
- **`RV-213`** — an empty meal genuinely renders a header `+` *and* a body `+ Add food`
  (`meal-card.tsx:73` and `:105`), two controls for one action.
- **`RV-166`** — **the exception, stated on the page:** its before is rebuilt from the component
  list in `cardio-content.tsx` rather than screenshotted, because the hub needs live data the
  sandbox does not have.

## The gate flips now, and only now

All four move to `Gate: owner`. That was **wrong** before and is right now: the mockup did not
exist, so the next act was to produce one, and producing it is work — which must stay ungated or
nobody is tasked with it. `LB-163` documents this transition, and applying the gate before the
picture exists is the trap this queue keeps falling into.

## `RV-166` is not like the other three

The first three are one component each, no stored data, reversal cost near zero. `RV-166` changes
**what counts as a completed session**, so every past run day becomes completable and adherence,
streaks and compliance all move. That has to be quantified before it merges, not after.

## The convention this establishes

`LB-135` exists because `RV-119`'s approved Home mockup was shown in a session and never saved, so
the approval is recorded and the artefact it approved is not — any session picking it up hits the
same wall. **A mockup is not shown until it is in `docs/design/`.** Noted on `LB-135`; its own lost
artefact still has to be redrawn.

**Not exercised:** a static page, not the app. No component was changed and nothing was rendered on
a device. Gates: `check-backlog-pointers` and `check-doc-links` clean by exit code.

---

## Answered the same day, and the cardio pane was wrong

**Approved:** `LB-163` and `LA-136` — gates cleared, both released to Lane B.
**Declined:** `RV-213`. No reason was given and none is invented in the entry; the finding stays on
the record and the entry is struck, because a declined change is finished rather than parked.

**`RV-166` was redrawn.** The owner asked two questions the first pane could not answer — *"if we
only have run/walk where does Other live? And if you do one; how do you do another?"* — and both
were real defects in the drawing rather than in the idea.

The mistake was conflating two separate things. The **prescription** is today's plan and there is
one of it; the **activity log** is what was actually done and there can be any number, of any kind.
The first pane showed the prescription card *replacing* the modality picker, which deleted `Other`
and left no way to log a second activity. Merging walk and run applies to the prescription only.

The revision shows two states — before training and after a walk followed by a bike ride — with the
picker present and unchanged in both, and a **Logged today** list where the activity that satisfied
the prescription carries a `Plan` chip and the second carries `Extra`.

**One edge is now explicit rather than assumed.** His rule was "one or the other", so `Run` and
`Walk` satisfy the prescription and `Other` does not: a 42-minute bike ride logs as Extra and leaves
the run To do. That is followed literally and flagged on the page as possibly wrong for him — if a
hard ride should count, the fix is a per-activity "count this as today's cardio" action, not a
blanket rule.

## `RV-213`'s reason turns a refusal into a rule

Asked why, the owner said: *"I like the original look; it shows the grouping nicely with the space."*
So the ~150 px the finding measured as waste is **doing work** — it is what separates one meal from
the next. Recorded on the entry as a **design principle for Nutrition**, not a one-off no: a future
sweep measuring blank space on the diary will reach the same finding, and should stop at that line
rather than re-file it.

## `RV-166` gained a walk flow, and it depends on a change shipped the same morning

He added: *"I will mostly do my treadmill walk; so when I click walk, I'd like to be able set a
guided walk — or just a treadmill walk + time. Or perhaps it could even say x amount of minutes in
x zone rate to count as complete."* Both halves are taken — the card states the criterion in zone
terms with live progress, and `Walk it` offers a guided walk or a treadmill walk with duration
chips. Drawn as **RV-166b** on the mockup.

**It only works because of `TN-78`, shipped the same day in #1774.** The moderate floor moved from
60% to 40% of heart-rate reserve. At 60% the floor was **134 bpm**, hit on 3 of 31 days — a
treadmill walk earned zero zone minutes, so a zone-worded target would have been unreachable on
foot. At 40% it is **107 bpm**, hit on 24 of 31. Neither change makes sense alone, and an
implementer taking `RV-166` without `TN-78` would ship a target the owner cannot meet by walking.

**One small decision left open:** whether a treadmill walk logged with no heart-rate data counts.
Recommended on the mockup — count the minutes, mark the day `estimated`, because refusing to
complete a walk he actually did is the worse failure. Not yet answered.

## The last open question, and the convention it reuses

A treadmill walk with **no heart-rate data does count** — the logged minutes go toward the target
and the day is marked `estimated`. Refusing to complete a walk he actually did is the worse failure.

**The app already models this distinction**, so it is reuse rather than a new mechanism:
`packages/shared/src/health/observed-hr.ts:125` carries `source: 'observed' | 'estimated'` on
`MaxHrResolution`, and `body-battery-inputs.ts` and `hr-profile.ts` use the same shape. A
discriminator beats a boolean for the reason that file demonstrates — it records *where the number
came from* rather than *whether to trust it*, so a third source can be added later without
rewriting every reader. Written into `RV-166` as an instruction, because the obvious
implementation is an `isEstimated` flag and that would be a second way of saying something the
codebase already says.

**`RV-166` is now fully specified.** All three approved changes are released to Lane B with their
acceptance criteria; nothing on this batch is waiting on the owner.

## The PR sat conflicted overnight, and the decisions were nearly lost

**#1794 did not merge.** Auto-merge was enabled and the branch went `dirty` — auto-merge waits for
checks, it does not resolve conflicts — so it sat from 11:33 on 09-27 until 09-28 while `main` moved
on by dozens of commits. **The owner's four answers existed only on that branch.**

Worse than the delay: another session, reading `main`, re-applied `Gate: owner` to all four with
fresh wording (*"the mockup has been shown; the code waits on his yes"*). That is correct behaviour
against what `main` said, and it meant the queue showed four entries waiting on an owner who had
already answered all four.

**Resolved by keeping this branch's newer text** — the conflict was `RV-166` only, where `main` held
the earlier *"owes a mockup first"* framing and this branch holds the approval, the walk flow and
the estimated-source decision. One line of history records the supersession. The gates the other
session added are cleared and the stale `Ask:` fields dropped, taking queue-wide `Ask: owner`
21 → 18.

**The lesson is about the mechanism, not the session.** Enabling auto-merge is not the same as the
PR merging, and nothing notifies you when it goes conflicted. A decision-carrying PR needs its merge
confirmed, not assumed — the same class as the standing rule that a check being green is not a check
having run.

<a id="2026-09-27-lane-a-bf214-claude-ro-views-file"></a>

# 2026-09-27 — BF-214 ①: the `claude_ro` views are one file, not 59 migrations

**Held for the owner.** He approved deleting the 59 migrations; the merge waits for his yes because
it changes what runs against production on every deploy.

## What changed

- `lib/data/postgres/claude-ro-views.sql` is the whole read-only view schema, generated in place.
  It was `289_claude_ro_views_grid_dimensions.sql`, moved byte for byte. A fresh regeneration against
  a migrated database was confirmed byte-identical before the move.
- `ensureSchema` (`lib/data/postgres/client.ts`) and `scripts/local-db/migrate.js` apply it after
  the migration loop, in a transaction, when `claude-ro-views.sql@<sha256:16>` is not yet in
  `schema_migrations`. `ensureSchema` logs a failure and keeps the previous views, which is how it
  treats a failed migration. `migrate.js` fails the run, which is what CI's Migration Check executes.
- **The 59 twins are deleted:** 287 → 228 migration files, 85,881 lines gone. Production has every
  one of those filenames recorded and never re-reads a recorded file, so nothing re-runs. The 18
  older twins that carried the owner's user id leave the working tree with them.
- `scripts/lib/migration-claims.js` floors the next number at 289. Without it, deleting 289 would
  have handed the number out again, and production already has a different file recorded under it.
- `claude-ro-views-file.test.ts` has four tests: no migration builds the `claude_ro` schema, the two
  appliers record the same marker, the file equals what the generator emits for the migrated schema,
  and the hash gate works (plus a broken file leaves the old views standing and records nothing).

## What the entry had wrong

- *"No CI check that the twin matches the schema"* is half-right. `claude-ro-readonly-role.test.ts`
  runs in CI, because the Tests job's `DATABASE_URL` is TCP, and it fails on a table with no view.
  Nothing checked columns. The regenerate-and-diff test does.
- The entry did not say that ① also removes the reason a column rename was impossible here: every
  historical twin named every column and was replayed.

## Verification

- **Mutation pass: 7 killed, 2 equivalent controls survived, 1 equivalent mutant.** Killed: hash gate
  removed; marker insert removed; `migrate.js` marker width changed; a column dropped from the file;
  a twin reintroduced as `290_…`; the allocator floor dropped. Controls: `=== true` on the gate, and
  `Math.max` argument order. The equivalent mutant was removing `BEGIN`: a multi-statement query is
  already one implicit transaction, so the file is atomic without it. The code comment now says so.
- **Migration Check, simulated:** fresh database → 228 applied, views rebuilt, 100 views; truncate →
  `--replay` clean; a third run rebuilds nothing.
- **First production deploy, simulated:** the ledger was given the 59 old filenames and no marker,
  then `pnpm dev` booted: `0 applied`, views rebuilt once, marker recorded. A second boot left a
  sentinel view untouched, so no rebuild.
- Touched tests and allocator tests pass; the full gate is in the PR.

## Not exercised

Production itself, and a real multi-replica deploy racing on the rebuild. Two replicas would both
`DROP SCHEMA` inside their own transactions; the second blocks on the first's lock and rebuilds
again, which is harmless and matches what a twin migration did.

<a id="2026-09-27-lane-a-rv219-day-log-exercise-type"></a>

# 2026-09-27 — RV-219 ①: `/api/day-log` says which lifts are bodyweight

Health → Day showed a chin-up as "0 kg". The repo already had the resolver
(`isBodyweightType`, `packages/shared/src/1rm.ts`), but `DayExercise` carried no exercise type,
so the card had nothing to pass it.

## What changed

- `ExerciseLog` (`packages/shared/src/types/log.ts`) gains an optional `exerciseType`.
  `buildWorkoutSessions` fills it with one lookup of `exercise_library` by the logs' `exercise_id`s.
  That lookup is separate from the log query, so the rows keep the shape every other caller reads.
- `DayExercise` (`app/api/day-log/route.ts`) carries `exerciseType`: `'bodyweight'`, `'weighted'`,
  or `null` for a log with no library row.
- **The render is Lane B's**, so it is filed as `LA-164` (`Needs: RV-219`) rather than done here.
  RV-219 leaves the queue: ② shipped in #1785, and ③ was always RV-208's.

## Checked before building

On production (owner's rows only, via `claude_ro`), **all 504 non-deleted logs carry an
`exercise_id`**, and "Chin-Up" resolves to `bodyweight`. A join through `exercise_id` therefore
covers the real data; a name-based fallback would have been machinery for rows that do not exist.

## Verification

- `rv219-day-log-exercise-type.test.ts` drives the route handler: a bodyweight, a weighted, and an
  unlinked log come back `bodyweight` / `weighted` / `null`.
- Mutants: the route dropping the field, and the adapter never resolving it, are both killed. The
  control (`??` → `||`, equivalent for non-empty strings) survives.
- `pnpm dev`: `GET /api/day-log` over HTTP returned `exerciseType` for a seeded session, `null`
  until its log was linked to a library row, then `bodyweight`. A bad date still gets a 400.
- The eight existing day-log and session tests pass unchanged.

## Not exercised

The device, and anything visible to the owner, which waits on `LA-164`.

<a id="2026-09-27-lb165-rules-plan-reaches-the-screen"></a>

# LB-165 — the fallback plan I shipped was reaching nobody

**Branch:** `lane-a/lb165-rules-plan-reaches-the-screen` · **Lane A**.

## What this corrects

RV-202 ① (mine, earlier) made the model-failure path return the program's own numbers instead of
a 502. The measurement was real — HTTP 200 where there had been 502 — and it was about the
**route**. LB-165 measured the **screen**, and nothing changed there: still ten 3-second polls,
still ~30 seconds of "Preparing your AI workout…", still the amber "couldn't generate" banner.

My own comment in that code asserted the benefit that did not exist: *"this plan is only what
today's caller is handed."* No caller was reading it.

## The chain, verified rather than taken on trust

Two links decide it, and both were checked against `main`:

- `workout-data`'s `regeneratePrescriptionInBackground` is **fire-and-forget** — it passes
  `onError` and never consults the result.
- `isAiPrescriptionPending` returns true purely on `prescriptionStatus === 'consumed'`, and only
  `storePrescription` clears that. Not storing meant the status never flipped, so the screen
  stayed "preparing" regardless of what the route returned.

## The fix

The catch now stores the rules plan with `RULES_PRESCRIPTION_TTL_MS` (6 hours).
`storePrescription` defaults the status to `'pending'`, which is what makes the screen paint.

**Why storing is right now when RV-202 refused it.** RV-202's objection was to the **seven-day**
hold — one provider blip becoming a week of uninformed plans — and that part still stands. Its
*conclusion* rested on the plan reaching the caller, which it did not. The objection is answered
by the expiry instead of by refusing to store: six hours covers the session in front of the lifter,
and `reevaluate` re-generates once `prescriptionExpiresAt` passes, so the model is tried again the
same day.

A duration rather than a local-day boundary, deliberately: a day boundary needs calendar
arithmetic and a timezone, and buys nothing over "a few hours from now".

## The test that pinned the old decision, inverted on purpose

It asserted the branch *never* stores. The property it was really protecting was "the model gets
another attempt soon" — so that is now pinned on the **expiry**: it must store, and must never use
the seven-day default. A second test holds the TTL to hours rather than days, so a constant that
crept upward would fail. Phase state must still not move; that half is unchanged.

## Verification

- `packages/shared/src/ai-periodization`: **148 passed (15 files)**.
- **Mutation pass: baseline survives, 3 killed, 1 equivalent control survives.** Killed: dropping
  the store call; a seven-day TTL; a 30-second TTL. Control: `6 * 3600 * 1000`.
- `tsc` clean; `pnpm build` clean; Custom Rules **82 of 82**.
- v1.477.6 with a changelog line — this is user-visible.

## Not exercised

**No device run, and the failure path cannot be induced here at all:** it needs the Gemini call to
fail, which the sandbox cannot force. What was verified is the code path and the state machine —
that `storePrescription` sets `'pending'`, and that `isAiPrescriptionPending` keys on `'consumed'`.
What is owed on the phone is that a real model outage now paints the base numbers rather than the
amber banner.

## Left for others

`RV-202 ③`'s third label case (`From your program`) in `components/workout/numbers-source.ts` is
now unblocked, because the client can see `source: 'rules'` on the stored plan. That is Lane B's
one-liner and LB-165 keeps it.

<a id="2026-09-27-mockup-tn82-morning-checkin"></a>

# 2026-09-27 — TN-82's mockup: should the morning check-in stop asking? (docs only)

**Branch:** `docs/tn82-morning-checkin-mockup` · **Lane:** Implementation B · **Code changed:** none.

## Why this and not the build

`TN-82` headed Lane B's READY list, and it is not startable as filed: it **removes two inputs from a
screen the owner opens daily**, which CLAUDE.md gates on a mockup at 384 px dark and a yes before any
code. `TN-85`'s own `Keep:` ② already recorded that — a finding from the session that shipped the
durable Home verdict — so this was verified rather than assumed.

Producing the mockup is ungated work, so that is what this session did.

## What was shown

Three frames, rendered from the running app rather than drawn, then reverted (`git diff origin/main`
empty): the sheet as it is today with both scales resting on 3; an ordinary night, where the app
states *"Sleep looks normal — filled in for you"* quietly; and an outlier night, where it states
*"Slept 5h10, 65 min later than usual. Marked this a poor night."* with a **That's wrong** control.

<https://claude.ai/artifact/Wx6SNHDTMVRBhJbCGctTAZ>

The wording is `verdictCopy()`'s, already shipped by `TN-85` — so what the owner is being asked to
approve is the **shape** (scales out, announcement in), not the sentence. The sentence is `TN-84`'s
and is still open.

## What building it exposed, which reading the plan did not

**`sleep-verdict` is the only verdict that exists.** There is no recovery verdict and nothing measures
one. So "replace the two scales" is really **two different changes**: sleep gets an announcement that
can be corrected, and **Recovery loses its input with nothing in its place**. The plan does not
distinguish them; the mockup makes it unmissable, because the Recovery scale simply vanishes from the
frame with nothing where it was.

Recommendation recorded on the entry: **remove Recovery too**, on the plan's own measurement —
`perceived_recovery` has **0 touched answers in 102 check-ins**, so it costs a reading that has never
once been taken. The alternative leaves one scale beside the announcement, which is the arrangement
the plan's §1 argues against.

## A correction made before publishing, not after

The first draft of the page argued: *"the sheet still asks 'Compared to yesterday', which is the same
question in the form you actually answer."* **The plan's own measured table refutes that** —
`vs_yesterday` was placed first specifically to escape the two scales and collected **2 of 82**,
decaying to zero like the other two. Checking the figures against the source rather than the entry's
prose caught it, and the honest argument is the stronger one anyway: asking has failed in **three**
forms and three positions, so a fourth way of asking is not the missing piece.

The same pass replaced a rhetorical "35 neutral 3s" with the measured `0 of 102`.

## Not exercised

Nothing on-device and nothing in the APK: headless Chromium at 384 px, so safe-area insets, real
gesture-nav clearance and Samsung's WebView are absent from every frame. No code shipped, so there is
nothing for a device pass to verify yet — `TN-82` already records that its build needs the APK, since
the morning sheet is the canonical daily surface and the local store is on its write path.

<a id="2026-09-27-mockups-home-nutrition-sitting"></a>

# 2026-09-27 — three Home/Nutrition mockups, shown in one sitting (docs only)

**Branch:** `mockups/home-nutrition-sitting` · **Lane:** Implementation B · **Code changed:** none.

## What this was

`LA-136`, `LB-163` and `RV-213` each proposed a visible rearrangement of a screen the owner opens
daily, and each was blocked on the same thing: CLAUDE.md's large-UI-change rule wants a mockup at
the real 384 px dark viewport and a yes before any code. All three were deliberately left **ungated**
because producing the picture is itself work, and `Gate: owner` would have parked them — the
inversion `LB-163`'s own body documents.

`LA-136` also said to show all three **together**: three Home/Nutrition mockups owed to one person,
and split across three sittings the same Home screen gets judged three times.

## What was done

**The mockups are the running app, not drawings.** Each proposed change was implemented temporarily,
captured at 384 px dark in the Playwright harness, and reverted — so what he is looking at is the
real thing rather than an artist's impression of it. `git diff origin/main` for the component files
is empty; no mockup code survives.

Published as one page with all six before/after frames, a recommendation per decision and the honest
trade beneath each: <https://claude.ai/artifact/SQxd9yfvjcbnZVseiPVwHh>

Each entry now records the link, carries `Gate: owner` (his answer is the only outstanding thing) and
carries an `Ask:` so it surfaces under **WAITING ON THE OWNER** rather than sinking into `PARKED`
beside 35 device gates — `Gate: owner` alone would have made the question invisible again, one step
later than before.

## Three things the render corrected, which reading could not

1. **`LB-163`: the tiles fill ~62% of the row, not 58%.** The earlier figure was measured at 412 px.
2. **`LB-163`'s trade was stated backwards.** The entry said three columns makes each tile
   *narrower*; they come out **wider**. The real cost is height — moving `Log` out of the icon
   overlay and into the flow as a genuine 44 px target roughly **doubles the row**, pushing
   everything below it down. That is what the page asks him to weigh, and it is not what the entry
   described.
3. **`RV-213` says four empty meal slots; there are six.** Collapsing them is ~1,400 px → ~800 px,
   and two cards previously under the fold — the goal-versus-budget explainer and "Finished logging
   for today?" — reach the same screen.

This is the fourth sitting in a row where an entry was right about what it saw and wrong about why
or how much. Render before fixing, and render before dismissing.

## One defect split out rather than left inside a preference

**`LB-169` (new, Lane B, ungated).** The empty meal's header `+` is `h-9 w-9` — **36 px**, under the
48 px floor every other icon button on the screen holds to (`components/nutrition/meal-card.tsx:72`,
verified in source, not inferred from the render).

It was found inside `RV-213` and does not belong there. `RV-213` is a layout preference gated on the
owner; a tap target under the floor is a defect with one right answer, and left inside that entry it
would have sat blocked behind a question about whether to collapse cards. It is also already live —
today the undersized `+` has a large "Add food" sibling, which is what makes it easy to miss — and it
becomes the *only* way into an empty meal if `RV-213` is taken. So the page presents the enlargement
as part of that change rather than inviting him to approve a regression, and fixing it under `LB-169`
means `RV-213` needs no such caveat whichever way he answers.

## Not exercised

Nothing on-device and nothing in the APK: these are screenshots from `next dev` in the Playwright
harness at 384 px, with Chromium's rendering rather than Samsung's WebView. Safe-area insets, real
gesture-nav clearance and native SQLite are all absent from every frame — so the *heights* quoted
above are the harness's, and the 48 px tap floor in `LB-169` is read from the source, not measured on
glass. No code shipped, so there is nothing for a device pass to verify yet; the on-device check
belongs to whichever of the three he takes.

<a id="2026-09-27-one-load-unit-spacing"></a>

# RV-208 ② — one spacing for a lifted load, and a guard that first checked half of it

**Branch:** `fix/one-load-unit-spacing` · **Lane B** · `components/**`, `app/session-select/**`.

The sweep found `7 × 68kg` on one screen against `98 kg` two cards down. Lane A settled the form on
2026-09-27 with `formatLoadKg` (`68 kg` / `67.5 kg` / `71.25 kg` — two decimals, trimmed, because a
1.25 kg plate step rounds to `71.3` at one). This converts the render sites.

## The entry named six sites; there were nine

`next-workout-card`, `week-day-sheet` and `formatVolume` were not on the list — it was a snapshot of
when the entry was written, and the sibling-surface rule says fix every surface in the same PR.

Eight are lifted loads and now call `formatLoadKg`. **`app/profile/[userId]/page.tsx`'s
`formatVolume` is excluded with its reason:** it renders a lifetime tonnage through `kT`/`T`/`kg`
tiers, deliberately rounded whole. It is not a load anyone lifted in one go, and spacing only its
bottom tier would leave the three tiers disagreeing with each other.

`app/api/**` is excluded too. Its five `${x}kg` are LLM prompt text (`nutrition-goals/recommend`)
and a Google Calendar event description (`log-calendar-event`) — neither is the app drawing a load
on a screen, a prompt's wording is tuned against the model rather than for card consistency, and
both files are Lane A's. Noted on the entry rather than swept.

## The guard passed its own control run, which is the thing worth recording

`rv208-one-load-unit-spacing.test.ts` is a sibling of the duration guard. Its **first version
matched only `${x}kg`** — a template literal. Half these call sites are JSX `{x}kg`, which is a
different construction, so reverting `pip-view` and re-running produced a **pass**. It keys on
`}kg` now and is control-run against both forms, with a reverted site of each kind.

A widened regex then flagged the *correct* `} kg` sites, so the no-space case is what it matches:
the form is the defect, not the unit.

## A fourth clock form is still live, and it is Lane A's

While checking ①, both functions were **run** rather than read: `formatTime12h('06:40')` returns
**`6:40am`** against `formatTimeOfDay`'s **`6:40 am`**. It sits in `packages/shared/src/date-utils.ts`
and feeds `activity-detail-sheet.tsx` and `activity-history-card.tsx` — **the "Health's activity
list reads 6:40am" surface this entry opened with.** Lane A's fix reached the day-timeline route and
`fmtAest`; it did not reach this. One character in a Lane A file, so it is written onto the entry
rather than taken here, along with the two minutes-of-day formatters that need a shared sibling
before their call sites can be converted.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors, 827 warnings · full unit suite green ·
build clean · the new guard 3/3, red with either form reverted.

**Not exercised — no render.** The seeded account has no weights on any of the eight surfaces, so
nothing was seen at 412 px, and building eight fixtures for a spacing change was judged out of
proportion. The residual risk is a **wrap, not a wrong value**: one added character in two tight
cells, `pip-view`'s overlay and `week-day-sheet`'s truncated row. Both are `tabular-nums` and neither
is near its container's width in source, but that is a reading rather than a measurement — it is
recorded on the entry as owed.

<a id="2026-09-27-or-182-queue-audit"></a>

# A full queue audit, and a policy that unfroze four entries at once

Orchestrator, 2026-09-27. Docs plus one baseline. The owner asked for a full review of assignment and
a bulk ask for anything needing him.

## The audit

All 538 entries run through the parser against five consistency tests. Four classes came back:

- **40 entries carried `Gate: owner` with no `Ask:`** — a question nobody had written down. This is
  the whole remaining blockage.
- **Five looked like a FAILED device result filed as verification debt.** Two were real, one was
  already discharged, two were false positives on prose.
- **Two `Verify:` on unbuilt work** — both correct on inspection (`DV-12` is a pass test, `DV-21`
  shipped).
- **No duplicate or conflicting lane fields**, and lane coverage stayed at 536 of 538 resolved, the
  two exceptions deliberate.

## The two real FAILED-under-Keep entries

**`RV-103`** — sweep 4a passed the original fix and found a new defect 1 of 1: after using **Retry**,
deleting that food left the card on 1,454 for 16 s while the server said 1,534. Deletes that had not
used Retry refreshed fine. The entry's own text said *"that is what this entry now owes"* and its
`Keep:` filed it as residue, pointing at the device. The diagnosis is already written — the Retry path
looks like it leaves the card's refresh subscription dead — so nothing is owed by the phone. Reopened
as Lane B work.

**`BF-98`** — the fix shipped, the S25 said it FAILED, and `Verify: device` kept printing it as
*shipped, a look is owed*. Struck.

## Four gates that were not the owner's

`TN-16` said *"NOT SIGNABLE yet, so do not offer it in a tuning batch"* — an instruction not to ask
him, written in the field that makes every sweep count it as his; it is `Lane: T` now, which is what
that lane exists for. `Q-29` said *"the ball is OURS, not theirs"*. `OR-115` gates the per-control
call on an inventory **that does not exist yet**, so it was owner debt for work nobody had started.

## Four answers, and one of them is a policy

**Production DB changes now have a standing rule** rather than four separate asks: **add and backfill
are authorised, dropping a proved-dead object is authorised with the evidence shown, and anything that
deletes rows holding data stays confirm-first** — every run behind a snapshot that is taken *and*
restored, printing its affected-row count against the prediction. It is in `CLAUDE.md`, not on the
entries, because it governs every future migration and an entry-local policy is one the next migration
will not find. `LA-143` and `BF-144` unfroze on it; `LA-71` and `Q-30` D4 correctly did not.

**`Q-279`: switch ACWR to uncoupled EWMA.** Measured over 95 real days — early-deload 12/95 → 15/95,
taper 4 → 1. He was offered re-tuning the 1.5 threshold to preserve the current four tapers and
**declined it**, which the entry now records: fitting a threshold to hold an outcome is how a
calibration drifts, and the point of the switch is that the four were not all genuine spikes.

**`Q-251`: no staging service yet**, with the trigger named — the first migration that damages
production authorises it without asking again. The gate is gone because nothing waits on him; the
entry waits on an event.

**`BF-98`: reading (b)** — the grouped meal row, not the section. Reading (a) is struck, so nobody
re-opens `meal-card.tsx:90` looking for a bug that is not there.

## Where it leaves the gates

`Gate: owner` **46 → 39**. `Ask: owner` sits at 22. Thirty-nine to go, and the two patterns that keep
paying: read the gate's own text first, and look for the one question whose answer unfreezes a cluster.

<a id="2026-09-27-or-183-github-intake"></a>

# The collaborator was right: nothing read GitHub

Orchestrator, 2026-09-27. Docs plus one baseline. A collaborator told the owner his issues and pull
requests *"are never getting touched/reviewed"*. Checked rather than assumed, and he is right.

## What was actually open

- **Issue #1620** (`jsboiss`, 25 Sep) — replace the manual migration counter with a calculated next
  number. **Nothing in the repo references it.**
- **PR #1607** — bearer tokens for native mobile login. Named in `TN-80` as waiting on the owner;
  **never reviewed.**
- **PR #1608** — HealthKit sample storage. Its branch name appears in one entry; **not tracked as a
  PR at all.**

## Why, and it is structural rather than an oversight

BugFix owns intake, and its two channels were spoken reports and `claude_ro.feedback_submissions`.
Neither is GitHub. `grep -c list_issues` over `CLAUDE.md` and `docs/agents/README.md` returned
**zero**.

Inbound pull requests were worse: **`CLAUDE.md`'s whole CI/CD section is written for *our own* PRs**
— *"when the user pushes a feature branch and opens a PR"* — so a PR from outside arrived into a
channel with no reader in any role. `TN-80` caught two of the three sideways while doing something
else, which is luck rather than a channel.

## The call

**GitHub issues are BugFix's third intake channel.** Same loop as the in-app feedback it already
reads: read → triage → file an entry with a lane → move the watermark. An issue is never answered by
replying to it.

**Inbound pull requests are Review's.** Reviewing a diff against this repo's rules is what that role
does, and an inbound PR is a code review with an author attached. BugFix takes the report, Review
takes the patch.

**Review may not merge one.** Outside code entering the owner's app, and both live PRs hit a
standing carve-out immediately — `#1607` is auth, `#1608` is storage. Review's authority stays
docs-only plus a posted review.

Both are in the session-start list (one line, compressed from eleven) and in both roles' sections of
`docs/agents/README.md`.

## What this does not fix

**The three already open.** A rule change reaches the next session, not the backlog of a channel
nobody was reading. `OR-184` carries them, with what each needs: `#1620` needs a read and an entry,
`#1607` needs a review and the owner's merge, `#1608` splits at the schema line where Lane A takes
over. It carries an `Ask:` — whether Review should post reviews on a contributor's PRs at all, which
is the owner's call about his own repo rather than mine.

**Not established:** whether the collaborator wants review comments or just merges. Worth asking him
rather than inferring.

<a id="2026-09-27-or-185-bugfix-watches-github"></a>

# One watcher for GitHub, and reviews that say only what is wrong

Orchestrator, 2026-09-27. Docs only. Two owner instructions, both corrections to what shipped hours
earlier in OR-183.

## BugFix watches GitHub — all of it

OR-183 split the channel: issues to BugFix, inbound pull requests to Review. The owner moved the
watching to one role — *"make that part of our rules that we are monitoring github from bugfix"* —
and that is the better shape. **A channel watched by two roles is a channel where each assumes the
other looked**, which is the exact failure that let `#1620` sit for two days.

So: **BugFix reads `list_issues` and `list_pull_requests` at session start** and files everything not
authored by the agent account. It triages an issue itself and hands an inbound PR to Review with a
`Lane:`. **One watcher, two readers.** Neither merges one — outside code entering the app, and both
live PRs hit a carve-out (`#1607` auth, `#1608` storage).

## The reviews get posted, and they are short

*"Yes write comments but make sure they are very concise. No fluff."* Two instructions, and the
second is the one that gets lost — so it is written as rules rather than as an adjective:

- No preamble, no praise, no restating what the PR does. The author wrote it.
- One finding per comment: the problem, the fix, and the `file:line` or rule that makes it one. **A
  finding with no cited rule is an opinion.**
- Nothing wrong → one line. Not a summary of everything checked.
- The attribution footer stays; that is the harness's rule, not padding.

One thing added unasked, because it follows from writing to a contributor rather than to the owner:
**name the rule rather than assuming it, and never imply their approach was careless when it is
simply not what this repo does.**

## The three live items

`OR-184` records the answer and routes them: `#1620` to BugFix to triage, `#1607` and `#1608` filed
by BugFix and read by Review, merges the owner's. **`#1607` gets checked against `Q-1a` first** —
same area, client half, and a conflicting design is the likely finding.

**They are now covered by the standing rule rather than by the entry**: BugFix's next session finds
all three without being told, so `OR-184` self-clears when it does.

## Deliberately not done

**No `Lane: BF`.** The routing gap is real — the next action on `OR-184` is BugFix's and no lane
names BugFix — but `OR-150` waited for fifteen entries and three sweeps before `Lane: T` earned its
place, and this is one entry. A fifth lane value for a single case is a channel nobody reads.

<a id="2026-09-27-or-186-branch-and-foreign-pr-rules"></a>

# Two rules to the knowledge bank: branch names, and whose PR it is

Orchestrator, 2026-09-27. Docs plus one baseline. Both owner instructions, recorded as rules rather
than as this session's habit.

## The word `claude` never appears in a branch name

The existing rule said *"branch names must describe the change"* and gave `claude/vibrant-volta-0SkCX`
as the example of what not to do — which reads as a ban on **generated** names, not on the tool's
name. The owner's instruction is the stronger one: **not the `claude/…` prefix the harness suggests
by default, not anywhere in the name.**

The rule now asks for a **descriptor prefix naming the kind of change** — `fix/`, `feat/`, `bugfix/`,
`issue/`, `request/`, `chore/`, `security/`, `docs/` — so `issue/1620-migration-counter` rather than
anything tool-named. The repository is public and its branch list is part of how the work reads to
anyone looking; a branch named after the tool says nothing about the change, which is what the rule
was for in the first place.

## Never merge a pull request we did not author

This is a hard stop, and it goes in Safety & Reversibility beside the production-DB policy because
it is the same shape: **a rule that removes an authority the rest of the file otherwise grants.**
*"Merge a tested, CI-green PR without asking"* reads as blanket permission until something says it
covers our own PRs only — and it does.

On someone else's PR the ceiling is **review, comment, approve**:

- **We MAY approve.** An approval says *we read it and nothing blocks*, which is the useful half and
  the thing an author is actually waiting on. Withholding it while having nothing to say is just
  slower silence.
- **We never merge.** No exception for green CI, no exception for a one-line diff.
- **Cannot approve → comment and wait.** Do not close it, do not push to their branch, do not open a
  rival PR, and **do not merge it because the comment went unanswered.** A stalled PR that is theirs
  stays theirs.

The `docs/agents/README.md` Review section carried *"Review's authority is docs-only and a posted
review"*, written this morning, which was narrower than the owner wants — approval was not on the
list. Corrected there too.

## Note on ordering

`#1756` was still auto-merging when this branch was cut, so the one-line session-start summary of the
approve rule lands with that PR's text rather than this one. The binding statement is in Safety &
Reversibility either way; nothing here waits on it.

<a id="2026-09-27-or-187-verification-discipline"></a>

# Three rules from three of this session's own mistakes

Orchestrator, 2026-09-27. Docs plus one baseline. The owner asked whether anything else was worth
adding to the knowledge bank. These are the three that earned it, all from failures in the last two
days rather than from imagination.

## 1. Verify with the tool that owns the question, never with a grep you wrote

Two wrong claims in two days, **both reported to the owner as fact before being checked**:

- `OR-174` said four surviving branches held live work, reasoning from *a branch name matching a
  queued entry*. Diffed afterwards, **not one held anything** — `main` was 208 lines ahead of one,
  byte-identical to another.
- A regex over the backlog reported **32 entries with no lane**. `parseEntries` said **2**. The scan
  missed the bare form (`— Lane A`) that 75 entries use and `lane.js` reads deliberately.

A grep is a guess at the shape of the data. The parser, the runner or the API is the authority, and
this repo has one for nearly every question worth asking. **Greps find candidates; they do not
count, and they do not conclude.** In `CLAUDE.md` under Communication, beside *never mark an issue
fixed from intent* — the same failure one step earlier.

## 2. Never write a field's token inside prose

The field parsers are **first-match-wins and know nothing about quotes or backticks.** A bullet
reading *"which is exactly what `Lane: T` is for"* **set that entry's lane to `T`**, ahead of its
real `- **Lane: B**` line. Separately, a rewrite left `Gate:` inside a quoted sentence and
`check-backlog-pointers` refused the push as a decorated field.

CI caught the second. The first was caught only because the value was re-read afterwards — which is
now the rule: **after any edit near a field, read the entry back through `parseEntries`.**

## 3. A sweep's action list is a hypothesis, not an instruction

`RV-156` named ~30 Known-Issues rows as ready for the archive. Tested one at a time, **eleven of
eleven failed the rule** — one described a live defect, one covered an entry still in the queue.

The sweep was not careless. It asked *"is this answered somewhere?"*; the archive rule asks *"is
anything still owed?"* Those agree often enough that the gap is invisible until tested. The
owner-gate triage had the same shape from the other side: a good fraction of gated entries said in
their own gate text that they were not decisions. **When a field and its own prose disagree, the
prose is usually right and the field is the bug.**

## The thing that is not a rule, and is the real finding

**`CLAUDE.md` has been raised five times in two days** — 1056 → 1061, across #1712, #1747, #1754,
#1757 and this PR. Every raise was justified on its own. All five were mine.

The file that every session reads before its first useful action is growing about a line per rule,
and **no ratchet stops it, because each raise argues its own case and wins.** `Q-220` measured the
orientation cost and is scoped to `projectOverview.md`; nothing covers `CLAUDE.md` itself. That is
not a rule to add — it is a compaction pass to schedule, and the argument for scheduling it is that
the agent adding the lines is also the one approving them.

## And the growth problem answered itself mid-PR

Writing this hit the runaway limit: `docs/overview/entries/` held **81 loose files against a 60
ceiling**, so the gate refused the push. Folded with `scripts/fold-journal-entries.js --limit=45` —
**81 → 36**, one new `history-2026-09-27-folded-2.md`, citations rewritten in two domain indexes,
six entries held back because an agent baton cites them. `check-doc-links` clean across 865 files.

Worth noting what that says about the `CLAUDE.md` observation above: **the journal has a ratchet and
a script, so its growth self-corrected the moment it mattered. `CLAUDE.md` has a ratchet and no
script**, so each raise is a judgement call made by whoever is adding the line. That asymmetry is
the actual gap, not the line count.

<a id="2026-09-27-or-188-project-overview-shrink"></a>

# The lean index was 79% Known Issues

Orchestrator, 2026-09-27. Docs only. First half of the repo cleanup the owner asked for.

## The measurement that decided the order of work

`projectOverview.md` — the file `CLAUDE.md` calls *"a lean index"* and sends every session to before
its first useful action — was **13,028 lines**. Broken down:

| section | lines |
|---|---|
| Current Status | ~2,600 |
| Waiting on the owner | 23 |
| **Known Issues & Risks** | **10,230 — 79%** |
| What's Left To Do | ~95 |
| Document Map | ~55 |

Every session was reading ten thousand lines of open-issue detail to find out what the project's
status was. `Q-220` measured the cost of that months ago and had been gated since.

## The move

The whole section is now `docs/overview/known-issues.md`. **Nothing was rewritten, reordered or
archived — 451 headings in, 451 out.** `projectOverview.md` is **2,812 lines**, and its Document Map
says plainly that a new Known Issue goes in the new file *"or the 79% grows back"*.

**One file rather than one per pillar**, which was the structural call made when this was unblocked:
`grep -n '^### .*\[sleep\]' docs/overview/known-issues.md` works exactly as it did, and the standing
rule depends on that grep. Per-pillar files would force an issue tagged `[sleep][platform]` to live
in one and go missing from the other. Verified after the move: the sleep grep returns 28.

## What the move broke, and how it was caught

**215 relative links.** The section was written when the file sat at the repo root, so every
`](entries/docs/…)` resolved correctly; from inside `docs/overview/` they all pointed at
`docs/overview/docs/…`. `check-doc-links` named two, which is what a checker does — it reports what
it can prove, not the class. Rewriting the class rather than the two it named turned up **214 of one
shape and one of another** (`e2e/README.md`, which needed `../../`).

That is rule 1 from OR-187 arriving the same day it was written: **the two the checker named were
candidates, not the count.**

## Also here

The journal hit its 60-file ceiling again and is folded — **81 → 36**, one new
`history-2026-09-27-folded-2.md`. `check-doc-links` clean across 864 files.

## Deliberately not done

**The new file is not ratcheted.** A Known-Issues list should grow when issues are found, and a
ceiling would put pressure on not recording one — the opposite of what **No orphaned findings**
wants. The control is the archive rule that already exists: move an entry out when nothing is still
owed.

**`CLAUDE.md` compaction is the other half** and is a separate PR — a 10,000-line move and a rewrite
of the rules file do not belong in one diff.

<a id="2026-09-27-or-189-claude-md-compaction"></a>

# `CLAUDE.md` gets its first tighten: evidence out, every rule in

Orchestrator, 2026-09-27. Docs only. Second half of the repo cleanup.

## Why this file and not another

**131,431 characters — about 33,000 tokens — paid automatically by every session**, before it reads
anything it chose to read. And it had been raised five times in two days (1056 → 1061), every raise
justified on its own, **all five by the agent that then approved them.**

The contrast with the journal is the actual finding. The journal has a ratchet *and* `fold-journal-entries.js`,
so when it hit its ceiling this week it self-corrected in one command. `CLAUDE.md` had a ratchet and
no script, so every raise was a judgement call by whoever was adding the line. Nobody was checking
that work.

## The principle applied

**Evidence moves; rules stay.** A rule needs to be readable at all times. The three-week
investigation that *proves* the rule is needed only by someone who doubts it or is working in that
area — and a rule that gets doubted is a rule that gets broken, so the working has to survive
somewhere findable rather than be deleted.

Two reference docs, each holding its material whole:

- **`docs/session-start-reads.md`** — the three production queries (`error_events`,
  `feedback_submissions`, database size) with every correction and trap: the 30-day prune argument,
  the 52 MB that is bloat not payload, the 1.71 MB/day attribution and its falsifiable step-down
  prediction, the `n_live_tup` estimate that read 0 against 764 real rows.
- **`docs/git-sandbox-investigations.md`** — the branch-cleanup investigation (why
  `git branch --merged` reported 3 of 1,562) and the shallow-fetch defect (why a PR can get zero CI
  runs), both including the wrong turns.

What stayed inline is each rule plus its one-line consequence. The session-start bullet still says
`error_events` prunes at 30 days and that a fault you saw and did not record is dropped; it no
longer carries the measurement that established the prune.

**131,431 → 118,777 characters. 1,061 → 937 lines.** The first tighten this file has had.

## The check that mattered, and its two false positives

Extracting blocks by boundary risks swallowing a neighbouring rule, so every **bolded phrase** in
the old file was diffed against the new file plus both new docs. It reported **one lost rule** —
*"commit before you switch branches, and never `git add -A`…"*.

It was a false positive: the rule is at line 726, present and unchanged. A second apparent loss,
**No orphaned findings**, was the same thing — that bullet was *edited* earlier today to repoint at
the moved Known-Issues file, so its exact text differs.

Both were settled by an exact string check rather than by reasoning about the regex. That is OR-187
rule 1 twice more in one day: **the scan produced candidates; it did not produce the answer.**

## Deliberately not done

**No script to keep this file compact**, which is the asymmetry named above and the obvious thing to
reach for. A fold script works on the journal because entries are append-only and independent;
`CLAUDE.md` is a rule set where the judgement is *which* text is evidence, and that is not
mechanical. The control is this precedent: **when the file next approaches its baseline, tighten it
rather than raise it**, and the two reference docs are where the material goes.

<a id="2026-09-27-or-191-plans-and-reviews"></a>

# Plans and reviews: one report added, 729 link rewrites declined

Orchestrator, 2026-09-27. Third part of the repo cleanup. **Most of this entry is work I decided
not to do, and why** — the measurements are the deliverable.

## Plans: 47 of 260 are live

A plan is live exactly while a backlog entry cites it, and that is a definition rather than a
heuristic: the protocol has PR 1 write the plan **and** its queue entry together, and PR 2 remove
the entry when the work ships.

Measured: **47 cited by the backlog, 160 cited only by journals/handoffs/reviews, 53 cited nowhere
at all.** So 82% of the directory is history — the same shape as `projectOverview.md` being 79%
Known Issues.

### Why they were not moved to an archive directory

The obvious move — 213 files into `plans/archive/` — costs **729 reference rewrites across 202
files**, three times the handoff move earlier today. Against that:

**Nobody browses that directory.** A reader reaches a plan by following a link from the backlog
entry that cites it. The move buys navigability that is not used, and pays for it in churn across
202 mostly-historical documents.

What was actually wanted is the *liveness answer*, and that is now
`scripts/check-plan-liveness.js`, reporting in the Custom Rules job beside the doc-size check:

```
check-plan-liveness: 47 live of 260 plans (213 are history — cited by no queue entry).
```

**It reports and does not gate.** A plan going quiet is normal; failing CI for it would only stop
people writing plans.

**A README index was the other candidate and is worse.** An index of "current plans" is stale the
moment a plan ships, and a stale index that gets trusted is this repo's most-repeated documentation
failure — the backlog's `Branch:` field is the standing example. A number computed at run time
cannot drift.

## Reviews: nothing to clean, and that is a measurement

187 reviews, flat. Unlike plans, **a review does not go stale** — it is a dated record of what was
found, and it stays true. The only thing that could be wrong is a review whose findings never became
entries, which **No orphaned findings** forbids.

Checked every one for an entry ID:

| month | reviews | none cited |
|---|---|---|
| 2026-07 | 16 | **14** |
| 2026-08 | 117 | **2** |
| 2026-09 | 54 | **0** |

The July cluster predates the entry-ID convention, so it is not evidence of dropped findings. Both
August cases were read rather than counted:

- `2026-08-07-full-app-review-prompt.md` is a **prompt** for a review session, not a review.
- `2026-08-18-empty-and-single-datapoint-accounts.md` states **"Findings filed: none"** and has a
  section headed *"Recorded as observations, deliberately not filed"* with the reasons — which is
  exactly what the rule permits.

**Zero orphaned findings.** The discipline arrived and stuck, and the right action on the reviews
directory is none.

## What this makes true

Across the three cleanup PRs: `projectOverview.md` 13,028 → 2,812, `CLAUDE.md` 1,061 → 937, the
`docs/` root 118 → 50, the journal 81 → 36, and the plans directory now reports its own liveness.
**No file was archived on a guess** — each move was justified by a measurement, and the two that did
not clear the bar were declined in writing rather than done quietly.

<a id="2026-09-27-request-owner-answers-round-2"></a>

# 2026-09-27 — the twelve buried questions, answered; and the check-in turns out to be 10% of readiness

**Branch:** `request/owner-answers-round-2` · Orchestrator

`BF-202`'s second pass gave thirteen buried decisions an `Ask:` field. Twelve were put to the owner
in three rounds; the thirteenth was withdrawn as not his. `Ask: owner` is **28 → 17**.

## Answered

| Entry | Answer |
|---|---|
| `BF-144` + `LA-71` + `LB-42` | **Approve the `destructive-migration` group** — snapshot first, three separate PRs |
| `Q-540` | **Drop `event_name`**, with the dead-object evidence shown |
| `Q-251` | **Not yet** — revisit after `OR-195`; deferred, not refused |
| `Q-297` | **E2E stays advisory.** Revisit only with a measured pass rate |
| `TN-72` (+`TN-74`) | **Re-derive the 84 days** via a bounded admin re-derive |
| `PS-51` | **Take the proposed mapping** — forest/house/castle off three different ladders |
| `BF-96` (+`BF-139`) | **Abbreviate the date** to `Wed 30 Sep`; temperature and UV both stay |
| `BF-145` | **Wallpaper tint stays opt-in** |
| `LA-89` | **Delete `oura/hr-sync`** once proved dead |
| `BF-168` | ***Start Again* was not pressed** — stale state, the entry's assumption confirmed |
| `TN-67` | **Do not hide the score** — and the rating must stop feeding it |
| `RV-166` | **Combine walk and run in the cardio hub**; either completes the prescription |

## Two answers that were bigger than the question

**`TN-67`.** He was asked whether to hide the readiness score until the check-in is saved. He said
no — *"we hit this issue before where nothing was usable till after my checkin; I dont like that"* —
and added the instruction the question had not asked for: *"I dont want the rated score by me to
affect the score derived for the day. It should be used to post tuning only."*

**That is not what the code does.** `readiness-composite.ts:30` sets `checkin: 0.10` — his
self-report is **10% of the readiness score** on every day he answers, via `checkinScoreFromEnergy`.
Filed as **`OR-200`**, `Lane: T`, because dropping a contributor re-weights the other nine and
re-scores history on every day he checked in. The proposal must state how many days move before
anyone builds it.

It also does not make the rating a clean validation target: he still sees the score before rating
and has refused hiding it, so the anchoring is **halved, not removed**. The 2026-10-20
re-measurement must be reported with that caveat rather than as a clean correlation.

**`RV-166`.** Asked whether a walk counts as doing a prescribed run, he answered with a design
instruction: *"the walk/run section should be combined in the cardio hub; and would require one or
the other to be done."* That dissolves the finding rather than ruling on it — but it is an
information-architecture change to a daily screen, so it **owes a mockup first**. That makes four
mockups for one sitting: `LA-136`, `LB-163`, `RV-213`, `RV-166`.

## One question withdrawn as not his

`LB-38` asked the owner to choose the barcode scanner. **Decided here instead: keep
`@zxing/browser`.** Which library decodes a barcode is tooling, which the 2026-09-22 narrowing puts
on the agent. It works, and the entry names no defect a swap would fix. What would reopen it is a
measured decode-failure rate, which nobody has taken.

## Conditions attached to the three approvals

All carry the owner's 2026-09-27 production policy: a **verified snapshot — taken *and* restored** —
before the run, and the affected-row count printed against prediction, **stopping on a mismatch**.
The schema group ships as **three separate PRs**, never batched, because a migration's revert is a
corrective migration. Each needs its number from `node scripts/next-schema-number.js`, not
`ls | tail -1` — `#1608` is holding 288/289 against `main`'s own right now.

**Not exercised:** documentation only. Gates: `Ran 83 of 83` Custom Rules, `check-doc-links`,
`check-backlog-pointers` — clean by exit code.

<a id="2026-09-27-request-owner-answers"></a>

# 2026-09-27 — eleven owner decisions answered in one sitting, and five traps found on the way

**Branch:** `request/owner-answers-2026-09-27` · Orchestrator

The owner asked for a single bulk prompt to unblock the lanes. All 22 `Ask: owner` entries were
read first; twelve were genuine decisions and were put to him in three rounds of four, each with a
recommendation first. Eleven came back. This is what they were and what moved.

## Answered

| Entry | Answer | Now |
|---|---|---|
| `TN-78` | A moderate minute starts at **40% HRR** (107 bpm), not 60% (134) | Lane A |
| `RV-161` ① | **Run `rederive-baselines`** — dry-run then run | Releases BF-13, TN-6, Q-506, TN-8, TN-42 |
| `TN-67` / `Q-72` | **Outlier-only** rating prompt; he will not rate daily again | Lane B |
| `LB-153` | **Merge all three palettes**, workout set colours included | Lane A |
| `LB-164` | **No** — the Coach button stays iconic | Entry removed |
| `LB-159` | Meal plans **default to the saved library** when it is non-empty | Lane B |
| `LA-136` | **Yes** to a Home sleep line from `sleepQualityFeel` — **mockup first** | Lane B |
| `RV-218`/`RV-164` | He rejected the premise: **one number**, = RMR + live activity ± goal deficit | `OR-191` |
| `BF-207`+`BF-209` | Redesign `/collection` — **after `PS-49`** | Lane B, `Needs: PS-49` |
| `TN-80` | **Security review on #1607, then he reads it.** No agent merges it | Lane O |
| `BF-201` ① | Size the finish-early margin to his **75th percentile** | Lane A |

`Q-30` was deferred, with a steer that is nearly an answer.

## The answer that was not on the menu

Offered three calorie numbers on his screen — the ring's 1,534, a goal of 1,660, a budget of 1,356 —
he took none of them: *"I just want one number the correct one - the one thats rmr + live activty
+/- deficit for weight goal"*. That is a formula, and **none of the three computes it** (the ring's
1,534 has the right inputs with no deficit applied). Filed as **`OR-191`**, Lane A, blocked on one
line from him: whether the 09-14 recommendation of 1,618 kcal was meant to replace the 1,660 the app
still budgets.

The lesson for the next brief: three numbers to choose between is not a decision, it is a menu.
He was asked which existing thing to show and answered what it should mean.

## Five traps found while writing the answers in

1. **My own prose set a field.** The bullet *"the run is the device agent's (`Lane: DV`)"* re-laned
   `RV-161` to DV — first-match-wins reads inside backticks. The same class CLAUDE.md already
   records for `Lane: T`, hit again within a day of writing it down.
2. **`BF-201` was parked by a `Needs:` line that said it wasn't.** Its own text read
   *"**Needs:** — nothing, deliberately. **Neither lane is blocked on this.** BF-197's … BF-199 …"* —
   and the parser took the two ids out of the prose after the dash. An entry declaring itself
   unblocked was unreachable in both lanes. Reworded to carry no `Needs:` field at all.
3. **`RV-161` item ④ was stale.** It asked for a decision on Q-527's corrupt 07-29 row; that was
   **approved 2026-09-25**, two days before. Corrected rather than re-asked — the owner would have
   been asked twice for the same answer.
4. **`RV-213` was `Gate: owner` with a mockup owed and no mockup drawn**, so the gate parked the
   entry and nobody was tasked with drawing it. The exact inversion `LB-163` documents. Ungated.
5. **`Q-30`'s retention question would have died inside a parked entry**, so it is split out as
   **`OR-192`** — ungated Lane O, with the measurement that has to precede re-asking him.

## Also reconciled

`TN-80` routed three GitHub items that **BugFix has since filed properly** as `BF-211`/`BF-212`/
`BF-213` — and `BF-213` carries a finding `TN-80` does not have: **inbound PR #1608 takes migration
numbers 288/289 that `main` already used**, and the collision destroys its `claude_ro` twin. Those
three are now the live record; `TN-80` is routing history and is struck once the #1607 security
review is posted.

## Not done

- **`BF-201` decision 2** — the rep→%1RM table — was dropped for room and is still owed.
- **`RV-161` ⑤**, PS-17's queue position, likewise.
- Gates at close: `Ran 82 of 82` Custom Rules, `check-doc-links: OK (879 files)`,
  `check-backlog-pointers: OK — 545 entries`. **No code changed, so no runtime surface was
  exercised and none needed to be** — this PR is documentation only.

<a id="2026-09-27-rv202-label-the-numbers-source"></a>

# The workout list says which day its numbers are from, and a shipped fallback turns out to reach nobody

Implementation Lane B, 2026-09-27. `RV-202 ③`, plus `LB-165` found while building it.

## What shipped

The pre-workout heading carries an amber pill naming where its numbers came from when that is not
today's server answer: **`From 26 Sept`** for a cached payload built on an earlier day,
**`Base program`** for the on-device program mirror. Today's payload is deliberately unlabelled —
a permanent note beside "Recommended workout" is furniture, and the lifter would stop reading it on
the day it meant something.

It reads against the header's own `Sunday 27 September`, which is the whole value, so the e2e guard
asserts the pill does not **wrap** below the heading at 412 px rather than merely that it exists.

## Three paint sources, not two

The entry named "the last cached or base numbers". There are three, and each answers separately:
this screen's own `workout-data:<id>` cache, Home's `workout-card:` prefetch, and the local-store
mirror when neither cache has anything. The two cache branches were byte-identical but for the
variable, so they now share one `paintSeed` body — three replacement sites covering four sources,
with the unit test pinning `setExercises`-replacements == `setNumbersSource` calls so a fourth
cannot be added silently.

`isWorkoutDataToday` was already there for the `loggedTodayInSession` strip and is the comparison
used. Its one unsuitable edge: a payload with **no** `dataDate` counts as not-today, which is right
for stripping a flag and wrong as a label trigger, because there is no day to name.
`cachedNumbersSource` returns null there rather than guessing.

## `workout-screen.tsx` is a size-ratcheted hotspot, and the rule was right

The first version added 19 lines to a file already at its 1833-line baseline, and
`check-component-size` refused it with "extract, do not append". The extraction that paid for it is
the one that should have happened anyway: `WorkoutDataSeed` and `freshExercises` moved to
`components/workout/workout-data-seed.ts` beside the new `seedNumbersSource`, because all three ask
the same question of the same payload. Net growth on the hotspot: **zero**.

## LB-165 — RV-202 ①'s rules plan reaches no screen

Item ③ needed to know whether a rules plan is ever on screen, so it could label one. Tracing it
established that **it never is**, in five code-certain links: the plan is deliberately not
persisted; `/prescribe` returns it in a body both client callers ignore; `workout-data` reads the
*stored* state and never consults the background generation it fires; and `isAiPrescriptionPending`
keys on a status the rules path never flips. So the ~30 s "Preparing your AI workout…" wait that
item ① was written to remove is **still there**.

The entry's own measurement — HTTP 200 where there had been a 502 — was real. It was a measurement
of the route, and the conclusion drawn from it was about a layer it did not test. The retraction is
written onto the entry beside it rather than replacing it, and the work is filed as `LB-165`.

## Not exercised

**Not verified on device.** This is a WebView-delivered change, so it reaches the S25 on a normal
Railway deploy with no APK — but nobody has looked at the amber pill on the phone. The harness
proves it renders and does not wrap at 412 px dark; it cannot speak for the Samsung WebView's
rendering of the amber against the card gradient. A Known-Issues row records that.

The `Base program` branch is **rendered from source reasoning only** — reaching it means an empty
cache *and* a local-store mirror, and `getLocalStore` returns null in the web sandbox, so the
harness cannot reach that path at all. The `From {date}` branch is the one that was rendered.

<a id="2026-09-27-rv208-numbers-and-durations"></a>

# One duration form, and the bug the second copy was hiding

Implementation Lane B, 2026-09-27. `RV-208`, part one.

## What shipped

**Thousands separators** at the three sites the device sweep confirmed: Home's metric tile
(`11900` → `11,900`, value and `aria-label`), Home's nutrition card (`0 / 1534 kcal`), and More's
profile, which printed `2815 XP total` one line above its own `2,815 XP`. Each now matches the
`toLocaleString()` its neighbours already used.

**One duration form**, routed through `packages/shared/src/format/units.ts` — the module RV-90
created after the same sleep total read differently on adjacent cards.

## The sweep found a defect, not just an inconsistency

`home-day-timeline` had a private `fmt(h)` that floored to the hour and rounded the remainder into
a `mins` it then discarded when the hour was zero. **A 45-minute nap rendered `0h`.**
`formatHoursMinutes` returns `45m`.

That is the case for consolidating rather than writing a style note: a second implementation of a
formatter is somewhere for a bug to live alone, unnoticed, because nothing else renders that
quantity the same way.

Seven copies in all — `walk-summary` and `weekly-stats-hub` (`55m` where every other surface says
`55 min`), `health-metric-sheet`'s `fmtHours` and its two latency renders, and the timeline's
`fmt`. Two of them took **hours** while the shared formatter takes **minutes**, which is plainly
why they were written instead of imported.

**A consequence worth expecting:** an exact hour now reads `7h 00m` rather than `7h` on the sleep
sheet and the day timeline. The padded minute is `formatHoursMinutes`'s deliberate choice, for the
`tabular-nums` columns these sit in.

## The guard, and what it deliberately does not match

`components/ui/__tests__/rv208-one-duration-form.test.ts` matches an interpolated name that *says*
minutes — `${durationMin}m`, `${onsetMin}m` — rather than a bare `${v}m`. The elevation and pace
chart axes are full of those and they are **metres**; a guard that failed them is one people delete
rather than obey.

One exemption, named with its reason: `formatSyncAge`'s `3m ago`. Relative age is a different
idiom from a duration, and "3 min ago" reads wrong. Consolidating it would be the sweep
overreaching.

## What is still open, and two of them are not Lane B's

- **Time-of-day casing is Lane A.** `formatTimeOfDay` emits `6:40am`; the uppercase `6:40 AM`
  comes from `app/api/day-timeline/route.ts:44`, which formats `h:mm a` server-side. One format
  string — and the route returning a display string at all is worth a look while it is open.
- **Unit spacing needs a `formatKg` that emits decimals as needed.** Its default is one decimal,
  so routing the lift sites through it turns `68kg` into `68.0 kg`, which is worse than what it
  replaces. `packages/shared/**` is Lane A's.
- **The movement-category palette needs two new hues.** `SESSION_PALETTE` is indexed by *position*
  (amber, green, indigo, blue, purple, red), so "Push orange, Pull green, Legs purple" is the
  owner's session order rather than a name map — and Movement Balance's `--accent-purple` and
  `--accent-green` collide with slots 2 and 5. Only four accent tokens exist, so a non-clashing set
  means adding two to `globals.css` with contrast checked there. Lane B, but design work, and it
  deserves its own pass rather than a tail-end of this one.
- **Dates and brand-in-food-name** are copy decisions and are untouched.

## A question this raised and did not answer

Every separator site uses a bare `toLocaleString()`, which follows the **device** locale — a phone
set to German renders `1.534`. The fix matches the convention already in the tree rather than
inventing a rival one. Whether counts should pin a locale, as clock times had to, is a
`packages/shared` call and therefore Lane A's.

## Failure surfaces not exercised

The S25. Two daily screens change what they print — the day timeline and the sleep sheet — and a
sandbox render is not the owner looking at them.

## Verification run here

`pnpm lint` 0 errors / 827 warnings (unchanged against the base) · `pnpm check:rules` Ran 80 of 80 ·
`pnpm test` · `pnpm build` · `tsc --noEmit` · `check-test-typecheck` none above baseline · doc-size,
backlog-pointers and doc-links green. Control run: reinstating the timeline's own helper fails the
guard.

<a id="2026-09-27-rv209-type-scale-floor"></a>

# The type scale has a floor, and the rest of the debt is frozen rather than swept

Implementation Lane B, 2026-09-27. `RV-209`, steps 1 and 2.

## What the audit found

42 font sizes — 13 named plus 29 arbitrary ones (`text-[10.5px]`, `[11.5px]`, `[12.5px]`,
`[13.5px]`…), from 7 px to 34 px — and **1,035 uses under 12 px**: 583 at 10, 287 at 11, 128 at 9,
down to 7. There was no token below `text-xs`, so every one of them was a per-site decision
written as a literal. That is how a scale grows half-pixel steps: not by anyone choosing them, but
by there being nothing to choose instead.

## What shipped

`--text-2xs: 11px` and its line height are in `@theme`, and the **nine sites the entry names on
the workout screens** are on it. Each was verified against `main` first, and every line number in
the entry was right — worth recording, because several entries this week were not.

**11 px rather than 12.** That is where the existing mass sits (287 uses against 583 at 10 px), and
it is reachable without re-laying out cards that a 12 px floor would. The four `set-card` sites
were already at 11 and look identical; what they gain is a place *on* the scale, so the next edit
cannot reach for `text-[10.5px]` without a reviewer seeing it. The five at 9–10 px move up.

The two uppercase eyebrows among the nine — `workout-clocks`'s label and the `1RM` / `REP MAX`
caption — went to 11 rather than 12 deliberately: the entry says eyebrows may sit at 10–11, and
they were below even that.

## Step 3 is a ratchet, not a sweep

`components/workout/**` still holds **103 sub-11 px literals across 24 files**, plus 41 more
written as `text-[11px]` now that a token exists. A hundred blind edits across twenty-four files
is a worse risk than the debt — one wrong class in a card read mid-set is a real cost, and nothing
would catch it.

So `components/workout/__tests__/rv209-type-floor.test.ts` baselines both counts **per file and
shrink-only**. Nothing new lands below the floor, every future touch of a file pays a little of it
down, and lowering a number is a one-line diff next to the fix. The exact-match assertion is
deliberate: a stale baseline means the debt was paid and nobody updated the number, which should
be visible rather than silently tolerated.

Chart axis text is P36's, and it is inside the baseline rather than exempted — "is this string an
axis label" is not a question a scan can answer, and a wrong exemption is worse than a frozen
count.

## Failure surfaces not exercised

The S25. Rendered at 412 px dark on the active workout screen: set cards, the percentage label and
the RPE strip all sit clean and nothing overflows. **Two of the nine were not on screen in that
state** — the last-session panel's `Last session —` line and its `1RM` caption — so those two are
read from source only.

The entry's other finding is untouched and still true: **26 of the small sites also sit at 40–70 %
opacity**. A size floor does not fix a contrast one.

## Verification run here

`pnpm lint` 0 errors / 828 warnings (unchanged against the base) · `pnpm check:rules` Ran 80 of 80 ·
`pnpm test` · `pnpm build` clean, with `.text-2xs` confirmed in the generated CSS rather than
assumed · `tsc --noEmit` · `check-test-typecheck` none above baseline. Control run: putting a
`text-[9px]` back into `set-card` fails the ratchet.

<a id="2026-09-27-rv210-keyboard-and-viewport"></a>

# The keyboard can resize what it covers — and nothing in the sandbox can prove it

Implementation Lane B, 2026-09-27. `RV-210`, all three items.

## What shipped

1. **`interactiveWidget: "resizes-content"`** in `app/layout.tsx`'s viewport export. This is the
   load-bearing one and the other two do nothing without it: Android's default is
   `resizes-visual`, which draws the keyboard *over* a page that keeps its full height, so neither
   `dvh` nor `env(safe-area-inset-bottom)` moves at all. Confirmed in the **built** HTML —
   `interactive-widget=resizes-content` in the viewport meta — rather than only in the source.
2. **All 23 `vh` heights → `dvh`**, across 22 files.
3. **`enterKeyHint="done"` on all 42 `type="number"` inputs**, across 28 files.

## What the entry got wrong, and the part worth keeping

It said "about 30 sheets". It was **23 across 22 files** — and **22 other sheets were already on
`dvh`**. A 22/23 split, recorded nowhere, so every new sheet was a coin toss between the two units.
That is the finding: not that some sheets were wrong, but that nothing said which was right. It is
why this shipped with a check rather than as a one-off sweep.

`enterKeyHint` was genuinely zero, as claimed. The entry named three files; the sweep took all 42
numeric inputs, because that is a tractable set (its "135 inputs" counts every input type) and a
partial fix here is indistinguishable from none.

**`done` everywhere, never `next`.** Every one of these forms is saved by an explicit button, so
Enter should dismiss the keyboard. `next` would promise a field-to-field traversal that the forms
do not define an order for.

## The guard holds both conditions, because either alone is a half-fix

`scripts/check-keyboard-viewport.js` (Custom Rules, now **81** steps) fails on a `vh` height *or* a
missing `interactiveWidget`. Control-run both ways: removing the viewport line fails it, putting one
`vh` back fails it. It blanks comments first — the two surviving `90vh`/`35vh` strings in the tree
are both prose explaining a height, and a check that flags its own explanation teaches people to
delete the explanation.

## None of this was verified behaviourally, and the sandbox cannot do it

A headless Chromium has no soft keyboard, so `interactive-widget` is inert there and `dvh` resolves
exactly as `vh`. Measured rather than assumed: a converted `max-h-[90dvh]` sheet computes
**823.5 px at a 915 px viewport** — 90% to the decimal. The conversion is a no-op in the harness
**by construction**. That is the correct outcome and it is not evidence the fix works. The
verification is RV-205's P26 on the S25, and it is owed.

## One interaction found while checking, not a defect

`components/ui/weight-dial.tsx` sizes itself from `window.innerHeight`, which `resizes-content`
makes shrink when a keyboard opens. It already listens for `resize` and re-snaps to an odd multiple
of its item height, and it is capped at 320 px, so it degrades rather than breaking. Worth a glance
during P26 rather than a pre-emptive change.

## Not exercised

Native/WebView keyboard behaviour, safe-area insets with a keyboard up, and the S25 itself — all of
which is the entire point of the change. A `projectOverview.md` Known-Issues row records that. No
APK is needed: this is viewport metadata and CSS units, delivered through a normal Railway deploy.

<a id="2026-09-27-rv211-empty-account-claims"></a>

# Home stops telling an empty account things that are not true — and one "stray mark" was the night sky

Implementation Lane B, 2026-09-27. `RV-211` items ①②③; ⑤ closed as not-a-defect; ④ parked, ⑥ open.

## What shipped

Rendered on the zero-data account at 412 px dark, which is the only way to reach any of it:

1. **No "Your week in review is ready"** for a week with nothing in it.
2. **Body Battery reads "No data yet · —"** instead of "Good · Steady · 50" — no band, no trend, no
   number, a no-signal icon in place of a battery-level one, and an empty progress track.
3. **The week strip shows "—"** for past days when there is no program, instead of "rest".

## The digest text cannot answer "was this week empty"

`buildWeeklyDigestText` always writes at least *"0 sessions, 0 kg total — first week of data"* and
*"No personal records this week"*, so the banner's `content` is never falsy and the week always
looked ready. The route already returns `metrics` beside the digest, which is what kept this in
Lane B rather than handing it to A.

`weekHasAnything` **ignores `weightChangeKg` and `hrv.source` on purpose**: both are computed across
the *two-week* window, so either can be populated by the prior week alone and would announce a week
that had nothing in it. Every `WeekOverWeek.week` it does read is the recap week's own value.

## The progress bar was not in the entry, and no source guard would have found it

The unit test pins the Body Battery header's conditions and they were all correct — while the bar
underneath still drew a 50% fill, which is the same claim in the more legible of the two places.
The e2e render caught it. That is the case for keeping that spec despite its runtime.

This continues `RV-38` rather than undoing it. That entry found the "Limited data" chip got *weaker*
as the data got worse and fixed it by keying on `!conf.sufficient`; that condition is untouched, and
`noData` only ever adds a stronger statement on top. The unit test pins both, so a future edit
cannot quietly re-gate the chip on `hasData`.

## Item ⑤ is not a defect — it is the background

The "dot between the Resting HR and Sleep rings" is a **star**.
`components/dynamic-background/particles.tsx` draws 18 of them at `Math.random()` positions, 1–2.5
px, mounted globally through the weather overlay. Four are visible in the zero-data render, in four
unrelated places — which is the tell: a per-card mark does not scatter. The "·" in the "Limited
data" chip is that chip's own `SignalLow` glyph at 12 px; there is no `·` character in the file.

**A source grep first said "does not reproduce", and that was the wrong conclusion.** The marks are
real on screen; they are simply not stray. Only rendering it separated the two.

## What the entry did not name, found on the way

The week strip's aria-label said ", rest day" for **every** session-less day, future ones included —
so a screen reader called next Friday a rest day. Fixed with the rest of item ③.

## Not exercised

**Not verified on device.** The three fixes are empty-state only, so the owner's own account is
unaffected by all of them — which also means a device pass adds little here and is not claimed as
owed. What *is* owed is item ⑥, which needs either the seeded render or the phone: the score-ring
row returns null when every score is null, so the zero-data account cannot reach it at all.

## Found on the way out: the E2E job no longer fits its own limit

Waiting on `#1760`'s advisory E2E — which it touched, so the lane's rule said to wait — produced
this instead of a verdict: the job ran **45m16s** and was killed by its own `timeout-minutes`,
annotated *"The job has exceeded the maximum execution time of 45m0s"*. The six specs it named had
all hit "Test timeout", across six unrelated areas, and none of them was the spec that PR added.

**It reports as `cancelled`, not `failure`**, which is also what a superseding push produces — so
the honest signal is indistinguishable from the harmless one unless you read the duration. Three
peer PRs the same hour reported E2E `success` in **42, 42 and 52 seconds**, because
`e2e-ui-touched.js` short-circuits the job when no UI is touched: the suite runs in full only on
the PRs that most need it, which is exactly when it exceeds its budget.

Filed as **`LB-166`**, with `Needs: LB-149` — that entry's 1.0s browser-death signature may be the
same saturation from the other end, and neither is established. `#1760` merged on its five required
green checks, which is what "E2E is advisory" is configured for.

<a id="2026-09-27-rv212-nutrition-tone"></a>

# Nutrition stops reading a partial day as a fault, and one item goes back to the owner

Implementation Lane B, 2026-09-27. `RV-212` items ①②; ③⑤ were already struck by sweep 64; ④ is the
owner's and is now `LB-167`.

## What shipped

1. **The energy-balance headline is no longer painted by zone.** At 2 pm a legitimately partial day
   drew a red 2xl number, which reads as an error rather than as "the day is not over".
2. **A taken supplement is muted rather than struck through.** A strikethrough reads as cancelled
   or deleted; taken is the opposite, and the green tick beside it already carried the meaning.

## Item ① was half-shipped on purpose, and the half not done is the interesting one

The entry asked for neutral *everywhere* while the day is open. `energy-card.tsx` had already faced
this and split it: plain foreground for the number, **colour retained on the label** because the
label carries " so far" on the current day, which makes it a running state rather than a verdict.
Its comment names `CalorieBalanceBar` as the component still colouring the number — so the fix here
was following an in-repo decision, not inventing one.

Overriding the label half would have re-litigated a documented decision on evidence the entry did
not bring. What the entry *did* add is the compounding — "in red, over a red bar" — and removing the
largest red element addresses that without discarding the qualified verdict. Both halves are pinned
by the test, so a later sweep cannot quietly take the label's colour as well.

## The sibling that must NOT be swept

`manage-supplements-sheet.tsx` also strikes through a supplement — but on `!s.active`, meaning
discontinued, where crossed-out is exactly right. A sibling-surface sweep on "line-through in
nutrition" would have taken both. The test asserts that one survives.

## Item ④ goes back to the owner, because he specified it

The entry asked to drop the meal tile's fork-and-knife placeholder as reading like a failed image.
`meal-thumb.tsx` records his instruction in its own docstring — *"it should show the default one in
the mockup if no image is attached"* — and states the placeholder is *"the always-present state,
not a fallback bolted on afterwards"* (BF-32), because a row without the box makes the list read
ragged.

Implementing it would undo a design he asked for, which is the shape the Coach-label revert
(`LB-164`) was about. Filed as **`LB-167`, `Lane: O`, ungated** — getting the answer is the work, and
`Gate: owner` would park it out of the Orchestrator's list. The brief recommends keeping it, names
what dropping it would genuinely be better at, and offers a third option (keep the tile, change the
glyph) that nobody has costed.

## Not exercised

**Not verified on device.** Both changes are colour and text-decoration on daily nutrition
surfaces, delivered through a normal Railway deploy with no APK. The sandbox cannot speak for how
the muted row and the now-uncoloured number read on the S25 — but neither adds an element, so there
is no layout risk, and no Known-Issues row is claimed for a device pass that would only confirm a
colour.

## Also filed: `pnpm test` exits 1 with zero tests failed

Hit twice this session on two unrelated files —
`EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`, printed as `Errors 1`
beside `1111 passed | 0 failed`. Neither reproduced: re-running the named file alone passes, and so
does the whole suite. It is a vitest worker-teardown race, not a test failure, and it is
indistinguishable from a real red at a glance — the correct response (read the failure count, then
re-run once) is exactly the wrong response to a genuine one. Filed as **`LB-168`**.

<a id="2026-09-27-rv214-session-card"></a>

# The session card shows an icon instead of the word "Dumbbell" — because three surfaces never used the map

Implementation Lane B, 2026-09-27. `RV-214` items ①③④; ② does not reproduce, ⑤ is a design pick.

## What shipped

1. **The icon slot renders a component.** It was `<span className="text-3xl">{session.icon}</span>`
   and `program_sessions.icon` is a free-text column, so a non-emoji value printed as a 30 px
   **word** beside a 20 px session name.
3. **"Last done 9 days ago"**, not "9 days ago", on a card recommending today.
4. **The recovery chips fade out** instead of being cut dead against the "RECOVERY" label.

## The device note's diagnosis was close, and the cause was one layer further out

Sweep 64 guessed *"an icon name rendered as text when the icon does not resolve — check the
session-icon map's fallback"*. The fallback is fine. **The surface never consulted the map.**

`getSessionIcon` (`lib/session-icon.tsx`) already owned the whole chain — emoji→Lucide, then palette
position, then `Dumbbell`. A-7 had converted `ai-periodization-status-card` and left a comment
claiming *"every other session surface uses getSessionIcon"*. **Three did not**: the recommendation
card, `program-exercise-list`, and `builder-review`. A claim in a comment is not a guarantee, which
is why this ships with `scripts/check-session-icon-render.js` rather than a fourth comment.

**No hierarchy change was needed.** The entry proposed retitling the card so the session name leads.
With a component in the slot it already does — confirmed in the render. Retitling would have treated
the symptom and left the word printing on two other screens.

## The check is narrow on purpose

The broad version — flag any `{x.icon}` in JSX — was written first and **measured**: four more
sites, `swipe-actions`, `capture-actions`, `activity-secondary-metrics`, `deload-explanation`, and
**every one declares `icon: React.ReactNode`**, where rendering it is correct. A line-level scanner
cannot tell a string field from a node field. Exempting four correct files by name would have taught
the next person that an exemption is how you satisfy the check, so it keys on a session-shaped
identifier instead and says so.

## ③ was wider than it read

"Yesterday" is ambiguous on a card recommending today — but so is **"9 days ago"**, which reads just
as easily as when the session is next due. Both elapsed branches now say what the number measures.
`"Trained today"` is untouched: `trainedToday` compares against that exact string, and the test pins
the pairing so a later copy edit cannot silently break the branch.

## ④ was reproduced before it was fixed

The render showed `RECOVERY | t | 100% Shoulders` — a lone "t", the tail of "Chest". The entry's
first suggestion ("start the scroller after the label") was **already true**; they are siblings in a
flex row. The cut came from `overflow-hidden` ending flush against the label. Took the second
suggestion: a 12 px fade at both ends, verified in the emitted CSS and in a second render.

## What did not ship, and why

**② does not reproduce.** At exactly 412 px the "Recommended today" pill sits on one line. Not
closed — the seeded session is named "Push", and a long name would take the width the pill needs, so
the sweep may have seen it beside one. Fixing a wrap nobody can produce would be guessing.

**⑤ is confirmed but is a pick.** The card's button is full-width green with no icon; the
pre-workout screen's carries a dumbbell. "Use the same variant" does not say which, both are daily
paths, and choosing arbitrarily is a visible change on no grounds.

## Not exercised

**Not verified on device.** Rendered at 412 px dark in the harness. The mask is `-webkit-`-prefixed
as well as standard because Samsung's WebView is the canonical runtime, but the harness is Chromium
and cannot speak for it. No APK needed — CSS and components reach the device through Railway.

<a id="2026-09-27-rv215-loading-states"></a>

# The weekly-stats skeleton can end — and the entry's other twelve cards were already fine

Implementation Lane B, 2026-09-27. `RV-215` item ①; ② is wrong about every example it names;
③ stands untouched.

## What shipped

`cachedFetchToday` swallows `!res.ok` unless the caller passes `onError` — the self-fetching-card
rule in `CLAUDE.md`. Weekly stats didn't, so a failure left `weeklyStats` null,
`loading={weeklyStats === null}` stayed true, and the skeleton animated until the app was killed.

The hub now takes `error`/`onRetry` and renders the shared `EmptyState` with a **Try again**. A
later success clears the flag, so the error cannot sit over data that has arrived.

**The error branch is checked before `loading`, and that ordering is the fix rather than a
tie-break.** A failure leaves `data` null, so `loading` is *also* true — put the loading branch
first and the skeleton still wins and nothing changes. The test pins the order with that reason.

Guarded twice: a source test for the wiring, and an e2e that serves a real 500 and asserts the
screen **leaves** the loading state. Control-run: removing `onError` fails both.

## Item ② is wrong about all three cards it names

It says *"12 components render `null` while loading or empty, so the card vanishes rather than
saying why"*, and names three. Checked, all three:

- `observed-hr-card.tsx` already passes `onError` and renders *"Couldn't load your heart-rate
  profile — pull to refresh"*. Its `return null` sits **after** that branch.
- `workout-density-card.tsx` and `nutrition-activity-trends-card.tsx` return null **only while
  loading**; once loading ends they render *"No workout density trends yet."* Both already carry a
  comment citing this exact rule and explaining that a swallowed failure and "nothing logged yet"
  are indistinguishable there, so they show the empty line either way.

**A `return null` while loading is a defer, not a vanish**, and the reading that produced "12"
cannot tell the two apart. So the count is unreliable and the hand-list is not a starting point —
it is wrong about the three cases anyone can check in a minute.

What a trustworthy version needs is a scan that flags `return null` on a component's **terminal**
state — loading finished, no error branch present. That is the self-fetching-card rule's missing
ratchet and is worth writing; it is simply different work from clearing a list of twelve.

## Not exercised

**Not verified on device.** The failure state was rendered at 412 px dark against a real 500. No
APK needed. The retry re-runs the same concurrency batch the first load used, so nothing here takes
a path the first paint does not.

<a id="2026-09-27-rv216-one-streak-formula"></a>

# RV-216 — a best streak below the current one, because the two were counting different things

**Branch:** `feat/rv216-one-streak-formula` · **Lane A** · no migration

## Not two copies of one formula

RV-216 files this as the *one formula, one place* class: two functions named `computeStreak`,
Home saying 111 and More saying "best 49", and a best below a current is impossible.

The first half is right. The diagnosis is not, and it changes the fix.

They count **different quantities**:

- `app/session-select/compute-streak.ts` does `count += 1 + consecutiveRest` — a bridged rest day
  is *part of* the streak. A span of **calendar days**.
- `lib/achievements.ts` does `streak++` once per dated entry — rest days bridge the gap without
  being counted. A count of **sessions**.

Replayed against the owner's real history (103 trained days, 2026-05-01 → 2026-09-26):

| | value |
|---|---|
| Home — calendar days, gap 2 | **111** |
| achievements — sessions, gap 2 | 83 |
| achievements — sessions, gap 1 (`maxCompliantRestGapFor` for a rotation) | **49** ← the reported figure |

So both reported numbers reproduce exactly, and **neither was arithmetically wrong**. 83 sessions
spanning 111 calendar days is just true. What was wrong is that both were labelled "streak" and
put on screens he compares.

## Which reading wins, and why it was not a coin toss

**Calendar days**, because three things written before this already say so: Home's card reads
"STREAK … days"; the four streak achievements read "7-day / 14-day / 30-day / 60-day training
streak"; and the StreakCard banner tells the user two rest days keep a streak and the third breaks
it. The session count contradicted all three while sitting next to them.

## The rest gap is a FLOOR, and that is the part I got wrong first

My first pass set a flat gap of 2 everywhere. That would have regressed **BF-122a**, whose comment
is in the file and says exactly why: someone training Mon+Tue has a five-day hole and is following
their plan through all of it — a literal 1 broke their streak every week, and a 2 would too.

But `maxCompliantRestGapFor` alone returns **1** for a rotation, which is what produced the 49
against a banner promising two rest days.

`streakRestGapFor` is `Math.max(2, maxCompliantRestGapFor(schedule))` and satisfies both: a
rotation gets 2 (the promise), Mon+Tue still gets 5 (BF-122a), and a user with no schedule gets 2
rather than the old 1. The floor is the app's promise; the max is BF-122a.

## A third thing the entry does not mention

`lib/achievements.ts`'s function is not only the workout streak — **food, sleep and calorie-goal
streaks use it too**, at gap 0, where counting dated entries is correct ("log food 7 days in a
row" means seven entries). A wholesale swap would have silently changed all three. It keeps its
behaviour and is renamed **`computeEntryStreak`**, so the two metrics can never share a name
again.

## What the mutation pass caught

Five mutants, one control. Four died immediately; **the most important one survived**, and the
reason is worth keeping.

| mutation | killed |
|---|---|
| count sessions instead of calendar days | **0 → 1** |
| drop the floor (`maxCompliantRestGapFor` alone) | 2 |
| floor becomes a ceiling (regresses BF-122a) | 3 |
| measure `current` to the last trained day, not to today | 1 |
| `best` ignores the current span | 1 |
| **control:** name the sorted list in a const first | **0 — survived, as intended** |

Counting sessions instead of days passed the whole file. The assertion meant to catch it was on a
streak running up to today, and `return { best: Math.max(best, current) }` handed back the
day-counted `current`, masking a session-counted `best`. The case that separates them is a **past**
best longer than the present one. Added — and its first fixture was wrong too (7 → 11 is three
rest days, which breaks at gap 2, so it read 7 rather than 11), which the test caught before it
was trusted.

## Verification

Equivalence proven rather than asserted: `computeDayStreak` returns **111** on the owner's real
history — Home's exact number — with best ≥ current. Run against Home's live implementation, not
a reimplementation of it.

Lint 0 errors; `tsc` clean; Custom Rules **80 of 80**; full suite **1,107 files, 10,353 passed / 87 skipped, EXIT=0**.

On the dev server: `GET /api/achievements` **200** with `bestStreak: 17`, and
`GET /api/friends/leaderboard` **200** with `allTimeStreak: 17` — the two agreeing is the point.

## Not exercised

**No screen was rendered and no device was used.** The numbers were read out of the two API
routes, not off Home or More.

**Home still holds its own copy.** The shared function was written to be behaviourally identical
to it, so nothing on Home changes today; the import swap is `LA-156`, which is Lane B's per the
entry's own split. Until then Home cannot read the schedule, so a *weekly* user will see Home
under-report against the achievements page. The owner is on a rotation, where the floor is what
applies, so he sees 111 on both.

**This raises his best streak from 49 to 111 and awards "Iron Will" (60-day).** That is the
change being made, not a side effect — but it is a number he reads, so it is worth saying plainly.
Reversal is one constant.

<a id="2026-09-27-rv217-contributor-labels"></a>

# RV-217 — three contributors rendering their own key, and the third time this class has shipped

**Branch:** `feat/rv217-contributor-labels` · **Lane A** · no migration

## What the entry said, and it is all true

Of the Sleep score's ten contributors, seven render a label and a chevron and three render the
internal key, lowercase, with nothing to tap: `hrv`, `hr`, `schedule`. Verified against `main`
rather than taken on trust — the model emits exactly ten keys
(`totalSleep efficiency rem deep latency timing hrv hr schedule restfulness`), `CONTRIBUTOR_KEYS`
maps seven, and `labelFor`'s fallback is `key.replace(/_/g, ' ')`, so an unmapped single-word key
comes back as itself.

**The fall-through is correct and stays.** `CONTRIBUTOR_KEYS` translates the model's keys into
Oura's vocabulary, and Oura's `daily_sleep` set is *exactly* those seven — `hrv`, `hr` and
`schedule` are the app's own additions with no Oura counterpart, so passing them through unchanged
is the right behaviour. What was missing is a label and a guide entry for what comes out.

## The sibling sweep found the same defect one step along

RV-217 asks to check Readiness for the same thing. Its labels are fine — RV-201 fixed them. Its
**guide** is not: of the nine contributors in `READINESS_WEIGHTS`, `checkin` is the only one with
no `contributor-guide` entry. So it was the one row on "What goes into this score" that reads
correctly and then does nothing when tapped. A label without a guide is the same defect with a
later symptom, and it is fixed here under the sibling-surface rule.

This is the **third** appearance of the class: RV-201 found `hrvBalance` rendering raw in the
readiness insight, and the same entry found `checkin`/`temperature`/`prevDayActivity`.

## So the test derives the keys rather than listing them

A list is exactly what let the next component arrive unlabelled. The sleep half runs
`computeSleepScore` against a night that fires every optional branch and asserts over whatever
comes back; the readiness half keys off `READINESS_WEIGHTS` directly. Both assert a label *and* a
guide entry, and the sleep half carries a vacuity guard — it fails if the fixture stops producing
all ten, which is the way a test like this quietly stops testing anything.

The label assertion rejects two things, not one: the raw key, and the de-underscored fallback
(`total_sleep` → "total sleep"), which is still the raw key wearing a space.

## Copy written from the curves, not from the names

- **HRV** — overnight average as a ratio to your own baseline; higher scores better; opt-in, so it
  is absent on nights without a baseline rather than fabricated.
- **Heart rate** — the same shape mirrored: `HR_RATIO` rewards at-or-below baseline and falls away
  fast above it.
- **Sleep schedule** — `Math.max(0, lateBed, earlyWake)`, so only the *worse* end counts and only
  in the penalised direction. An early night or a lie-in costs nothing, which is worth saying on
  the card because it is not what "schedule" suggests.

## Verification

Custom Rules **80 of 80**; lint 0 errors; `tsc` clean; `check-test-typecheck` at baseline; full
suite **1,108 files, 10,358 passed / 87 skipped, EXIT=0**.

5 tests. Mutation pass, 4 mutants + 1 control:

| mutation | killed |
|---|---|
| remove the `hrv` label | 1 |
| remove the `schedule` guide | 1 |
| remove the `checkin` guide (the sibling) | 1 |
| sleep model stops emitting `hrv` (the vacuity guard) | 1 |
| **control:** reorder the three new labels | **0 — survived, as intended** |

## Not exercised

**No screen was rendered and no device was used.** `labelFor` and `guideFor` are pure functions
and are covered by test; what is *not* covered is that the Sleep list actually draws the new
labels and chevrons. The routes that load these modules were driven on `pnpm dev`
(`/api/readiness-score` and `/api/body-battery` both 200); `/api/ai/health-insight`, which uses
`labelFor` server-side, is POST-only and was not driven.

**The third item of the entry is not done.** "Find what renders the empty gaps" is a layout
question the screenshot cannot settle — the two candidate causes look identical in source — so it
is filed as **LA-157**, `Lane: B`, to be reproduced at the 384 px dark viewport. The label and
chevron halves, which are what made the list look broken, are done.

<a id="2026-09-27-rv218-nutrition-copy"></a>

# "205 workouts" was 205 kcal, and a deficit was printed twice over

Implementation Lane B, 2026-09-27. `RV-218`'s copy bugs. The rest of the entry is Lane A's, and
this establishes that rather than assuming it.

## What shipped

- **`movementSummary` gives every addend its unit.** Under a calorie bar it read *"205 workouts ·
  32 steps"*, where both numbers are kcal — so it parsed as a **count** of workouts and a number of
  steps. That is a different claim about the same day, and a plausible one. It now reads
  *"205 kcal workouts · 32 kcal steps"*, fixed once in the single producer that feeds both Home and
  Nutrition.
- **The deficit prints its magnitude.** `energy-timeline-chart.tsx` printed the signed `net`, and
  on that branch `net` is negative — so the minus sign and the word "deficit" both said "under",
  which reads as a *negative deficit*, i.e. a surplus.

**The surplus branch keeps its "+" deliberately**, where sign and word agree. That asymmetry is
pinned by a test, so nobody tidies it into a second double negative.

## The test caught my own change, which is the guard working

`movement-breakdown.test.ts` pinned the exact string `"320 workouts · 227 steps"` and failed the
moment the unit went in. Updating it was right — but pinning a whole string is what made it a
tripwire rather than a guard, so the new case asserts the unit **per addend** with a regex. A
reworded separator or a reordered list can no longer quietly drop it.

## One of the three copy bugs was already fixed

*"0 / 1534 kcal"* beside *"1,534 left"* was **RV-208's separator item, shipped in #1743 earlier the
same day**. `home-nutrition-card.tsx:113` already calls `.toLocaleString()` on both numbers.
Verified against `main` rather than re-fixed.

## Why the rest of the entry is Lane A's

The entry hedged — *"if the numbers come from different routes, the reconciliation half goes to
A"*. They do:

- **Items ① and ②** (which number the ring's denominator is; making "burned" on Day and Nutrition
  come from one function) are a reconciliation across routes.
- **Item ④** (a "7-day" chart drawing five bars) is the route under-delivering on its own contract.
  `app/api/nutrition/weekly-summary/route.ts` computes the window itself — `from =
  shiftDateStr(today, -6)` — then returns `repo.listFoodLogsSummary(...)` **verbatim**, an
  aggregate that omits days with no rows. **The route is the only layer that knows the window**, so
  that is where the gap belongs. Padding in `weekly-nutrition-chart.tsx` would make every future
  consumer re-derive those seven dates, which is how a second copy of a window starts.

The entry is re-laned to `A` with that reasoning on it, so the next reader does not re-derive it.

## Not exercised

**Not verified on device**, but the one layout risk was checked rather than left open. The new
string is five characters longer per addend, and with three addends that is fifteen — so the
question is whether it overflows. It cannot: `calorie-zone-bar.tsx` renders it inside a
`<p className="text-[10px] leading-snug …">` with **no `truncate`, no `whitespace-nowrap` and no
fixed height**, so it is flowing prose that wraps onto a second line at worst.

Both changes are text in strings and reach the device through a normal Railway deploy with no APK.

<a id="2026-09-27-rv219-day-workout-card"></a>

# The exercise name stops being cut where it matters, and the "0 kg" is Lane A's

Implementation Lane B, 2026-09-27. `RV-219` item ②. Item ① is confirmed and belongs to Lane A for a
specific reason; ③ is RV-208's.

## What shipped

`"Chest-Supported Dumbb…"` cut exactly the words that tell that row from every other one. The name
now wraps (`truncate` → `line-clamp-2`, on both the button and span branches). Rendered at 412 px
dark with an injected long name: **"Chest-Supported / Dumbbell Row"** over two lines, with the sets,
the weight and both icons still aligned on the row.

## The entry's other suggestion is ruled out by a different standing rule

It offered an alternative: *"shrink the edit and delete icons, which take about 25% of the row twice
over."* **The measurement is right** — `ICON_BTN` is `h-12 w-12`, so 96 px of roughly 380 usable at
412 px. But **48 px is the Android minimum touch target** and this repo's tap-target floor, so
taking that option trades a naming problem for an accessibility one.

The test pins `h-12 w-12` alongside the wrap, so the trade is not made later by someone who has not
read this. That is the more useful half of the guard: the wrap is obvious once seen, and the reason
the icons must stay large is not.

## Item ① is real, and the card cannot fix it

Rendered and confirmed: a bodyweight row shows **`0kg`**.

The repo already has the resolver *and* already states the rule — `isBodyweightType`
(`packages/shared/src/1rm.ts`), whose module comment reads *"Every surface that shows a stored 1RM
resolves its unit here rather than hardcoding kg"* (BF-162, Q-19). So this looks like RV-214's shape:
a surface that skipped a documented convention.

It is not. **`DayExercise` carries no `exerciseType`** — only `name`, `weightKg`, `sets`, `reps` —
and every existing consumer of `isBodyweightType` receives the type as a *prop*. There is no
name→type lookup on the client to copy, so building one here would be new machinery beside an
established pattern.

The fix is one field on `app/api/day-log/route.ts`, after which the card resolves the unit the way
every other surface does. That is a route change, so the entry is re-laned to **A** with the
reasoning on it.

## Not exercised

**Not verified on device.** Rendered at 412 px dark. No APK needed — a Tailwind class reaches the
device through a normal Railway deploy.

**No e2e spec was added, deliberately.** `LB-166` (filed earlier today) records that the E2E job
already exceeds its own 45-minute limit, and the unit guard plus the render covers a CSS class
change. Adding a spec here would spend the budget that item is about.

<a id="2026-09-27-security-mobile-token-review-followup"></a>

# 2026-09-27 — security review of inbound PR #1607, and the lifetime mismatch it surfaced

**Branch:** `security/mobile-token-review-followup` · Orchestrator

The owner chose, from the 2026-09-27 decision round, that inbound PR **#1607** (bearer tokens for
native mobile login, from an outside contributor) gets a security review and then he reads it
himself. No agent merges it: it is an auth change and it is not ours, so the ceiling is
review/comment/approve, and approval was deliberately withheld for him.

## The review

[Posted on the PR.](https://github.com/nekodas-neko/TrainingAi_Open/pull/1607#issuecomment-5854224892)
Three findings:

1. **No test for the new branch.** `lib/__tests__/user-account-routes.test.ts:332` already has a
   describe block for this route; `responseType: 'token'` adds none.
2. **No per-token revocation.** A leaked bearer is valid until `exp` — 7 days — and the only kill
   switch is deactivating the account, which revokes every device at once. The cookie path had
   `httpOnly`/`secure`/`sameSite`; a bearer in client storage has none of them.
3. **A pre-existing lifetime mismatch** in the file the PR touches — filed as `OR-193`.

## What the review confirmed, so it is not re-derived

The PR reuses infrastructure rather than adding a second credential path. The token returned is the
**existing NextAuth session JWT**, and `auth()` already resolves it through
`lib/auth/bearer-session.ts` with a per-request `isActive` re-read — so a deactivated account's
bearer stops working without waiting for expiry. `secureCookie: isProduction` matches
`bearer-session.ts:38`; a mismatch there derives a different key and silently rejects every token,
so the agreement is load-bearing rather than cosmetic. PKCE, one-time token consumption and the
10-per-5-minutes rate limit are unchanged, and `responseType` is validated **before**
`consumeMobileAuthToken`, so a bad value does not burn the token.

`BF-212` flagged that `Q-1a` covers the same area. It does — as **reuse**, which is the good case.

## `OR-193` — the cookie outlives its own token by 23 days

`exchange-mobile-token/route.ts` sets the session cookie with `maxAge: 30 * 24 * 60 * 60`. The JWT
inside it has `maxAge: 7 * 24 * 60 * 60` (`auth.config.ts:9`). From day 7 the browser presents a
cookie whose token `getToken` rejects, for another 23 days — a silent sign-out on the mobile path
with the cookie still present. Not a security hole (the expired token is refused, the safe
direction), but the cookie promises what the credential does not keep. The fix is to derive the
cookie's `maxAge` from the session's rather than restate it; raising the JWT to 30 days would be the
wrong direction, since #1607 makes the leaked-bearer window newly relevant.

## `TN-80` was struck, and the strike was reverted at the merge

This PR originally deleted `TN-80` on the reasoning that BugFix's `BF-211`/`BF-212`/`BF-213` had
superseded it. **That was true when written and false by the time it merged.** While this branch was
open, BugFix added a measured census to `TN-80` that exists nowhere else: **seven PRs need the owner,
not three**, two of them **blocked rather than waiting** — `#1749`'s Migration Check reports
`58 failed`, all `column t.active_calories_est does not exist`, and `#1499`'s Build fails the
test-typecheck gate its description reports as clean, because `tsconfig.json` and
`tsconfig.tests.json` are different gates.

The conflict resolution keeps their version whole and adds the review note to it. The entry now
carries an explicit **do not strike** bullet, because the instruction to strike it is still sitting
in its own body and would otherwise be followed by the next session that reads it.

**Five PRs are genuinely waiting on the owner** by that census: `#1755`, `#1672`, `#1671`, `#1608`
and `#1607`.

**Not exercised:** no code changed in this PR, and the reviewed code was read rather than run — the
findings are static. Nothing was verified against a running mobile client.

<a id="2026-09-27-status-bar-scrim-pushed-routes"></a>

# DV-22 — the scrim was one layer too low

**Branch:** `fix/status-bar-scrim-pushed-routes` · **Lane B** · `app/layout.tsx`,
`components/shell/**`, `lib/shell/**`.

`/health/sleep` scrolled under the status-bar clock with no backing. This is DV-6's defect on a
surface DV-6's fix never reached: the scrim was mounted in `tab-shell.tsx`, which was right for the
five tab panels and is exactly why the pushed routes had none. Nothing regressed — the fix was
scoped narrower than the defect.

## Three things were wrong, and each fails silently alone

The entry asked for two things to be established before building. Both were measured at 412 px
rather than read, and the second turned up a third fault.

**① Which layout every pushed route shares.** There is exactly **one** layout file in this app —
`app/layout.tsx`, whose `<main className="relative z-[1] h-full">` wraps every route. So the mount
hoists there, beside the other global singletons, and the shell's mount is removed. The stacking
order is unchanged: z-40 at the root still paints over the page (z-[1]) and under the warning
banners (z-[60]), the same order it had one level down.

**② Whether the controller still holds when the scroller is a pushed page.** It does not, for two
separate reasons. `/health/sleep` has **no inner scroller and no panel** — it scrolls the document,
and a document scroll's event target is the `Document`, not an Element, so `if (!(el instanceof
Element)) return` discarded it outright. And the panel scoping asked whether a scroller was inside
`[data-tab-active="true"]`, which a pushed route never is. The scoping is now stated as the
negative — a scroller drives the scrim **unless it sits in a panel that is off show** — so the
pushed route qualifies by the same rule rather than through a second branch, and
`document.scrollingElement` (never inside a panel) falls out of it for free.

**③ The re-evaluation trigger, which the hoist broke.** Two things change what is on screen without
firing a scroll event. A route change is `usePathname()`. A **tab** change is not: the shell swaps
panels with a raw `history.replaceState`, which the App Router does not observe — so the attribute
it flips is the signal, read by a `MutationObserver` with `attributeFilter: ['data-tab-active']`,
which fires only for that attribute rather than on every render in the subtree. Losing either is
silent: the scrim simply keeps whatever the last screen left it.

## Control-run both ways

- Reverted everything: the scrim is **not in the DOM** on `/health/sleep` — the reported defect.
- Hoisted the mount but kept the old controller: the scrim is there and **stays at opacity 0**.

So both halves are load-bearing, measured rather than asserted. The tab test passes in both control
runs, which is what says DV-6 has not been regressed into.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors, 827 warnings · **10,566** unit tests passed
· build clean · controller suite 15/15 (three new cases) · the render spec green with the fix and
red without it, twice over.

**Not exercised:** the S25. Chromium cannot say whether the gradient composites on Samsung's WebView
or how it reads against the real status bar, which are the two things the device check is for; a
Known-Issues row states the pass test. One smaller gap: `document.scrollingElement` is null under
jsdom and is stubbed in the unit test — the browser probe read the real one, so no fallback was
added for a case the canonical runtime cannot produce.

<a id="2026-09-27-tn70-resilience-snapshot"></a>

# TN-70 — capture the 30 published resilience rows before the prescribed pass deletes them

**Branch:** `lane-a/tn70-resilience-coverage` · **Lane A** · docs-only.

## What this session was for

TN-70 sat at the head of Lane A's READY list, so I picked it up to implement. Its one remaining
step was *"a wide pass [that] would fill history — that pass is the work, and it has not been
run"*. Re-verifying that against `main` before building it — which is the standing protocol, and
which has changed the shape of the work on five entries running now — turned up a reason not to
run it as written.

## The finding

**The pass would destroy the evidence TN-70 exists to explain.**

`upsertDailyDerived` resolves every column as `COALESCE(excluded.<col>, oura_daily_derived.<col>)`
(`lib/data/postgres/slices/oura.ts`), so a recomputed value wins wherever it is non-null. The wide
pass fills `night_hrv_baseline_ms` — which is the point of it — **and in the same statement
overwrites `resilience_level`, `resilience_granular` and the three daily indices on every day the
recompute publishes one.** TN-70's decisive question is *"do those 16 July days still come back as
5?"*. Running the pass answers it by deleting the before-value, so it can be asked exactly once,
and only if the before-values were recorded first.

Nothing in the entry said this, and the entry has now been picked up and re-derived three times.

## What shipped

- **[`docs/reviews/2026-09-27-tn70-resilience-snapshot.md`](../reviews/2026-09-27-tn70-resilience-snapshot.md)**
  — the 30 rows, per day, read-only from production. Of **132** derived days spanning 2026-05-07 →
  09-27, exactly **30 carry a `resilience_level`**: the 16 July/August days and the 14 September
  ones the entry tabulates. That is the whole evidentiary base for this metric, and it is now
  recorded, so the pass is safe to run as far as the comparison goes.
- **TN-70 amended** with the overwrite hazard and a pointer to the snapshot, and moved to
  **`Gate: owner`** — the only blocker left is that the pass is a production write. It had been
  reading as startable, which is how it kept being picked up.
- **The readiness domain index** links the new doc.

## Two corrections to TN-70, from the capture

1. **`confidence` does not merely fail to separate the regimes — it spans the identical four values
   in both.** The entry reports means of 0.464 against 0.434. Both regimes draw from exactly
   `{0.357, 0.429, 0.500, 0.571}` = `{5,6,7,8}/14`. It is `validCount / 14` taking one of four
   values either side, carrying **no** distinguishing information. The means overstate it.
2. **The "switch is carried by `resilience_daily_sleep_recovery`" finding rests on 5 days against
   6, not 16 against 14.** Those three daily indices are NULL on the other 19 of the 30 rows. The
   mechanism is not overturned — it is still the only stored column that moves across the boundary
   — but the sample is a third of what the framing implies, which is why the recompute rather than
   further reading is what would settle it.

A third asymmetry is confirmed rather than corrected: `daytime_stress_coverage_min` is present on
0 of 16 July rows and 14 of 14 September ones, which is the column's age (#817, 2026-09-02).

## Deliberately not done

**The pass itself was not run.** It is a production write, which is the owner's call, and the ask
is now narrow enough to answer in one line — see TN-70's `Gate: owner`.

**No raw physiology was copied into the repo.** The snapshot holds the date and the resilience
columns only; no HRV intervals, heart rates or sleep timings.

## Verification

Docs-only, no code touched. `check-backlog-pointers` OK (539 entries), `check-doc-links` OK
(897 files), `check-index-doc-paths` OK (1235 paths), Custom Rules **80 of 80**.

**Not exercised:** nothing runtime — there is no code in this diff. Production was read, never
written.

<a id="2026-09-27-tn70-resilience-third-regime"></a>

# TN-70 — a third regime: resilience stopped publishing altogether, and nothing says so

**Branch:** `docs/tn70-resilience-third-regime` · **Lane A** · docs only, no code

## TN-70 was not startable, and that was already written down

The entry prescribes a decisive test — re-run the rollup over the level-5 window — and a later
Lane A pass established that it **cannot be run from a container**: against production it is a
production write (the owner's call), and non-destructively it needs 191,191 raw rows through an
endpoint capped near 1,000, plus a ~40-member `io` no test in the repo builds. The alternative
read it suggested instead was done on 2026-09-25 and killed the baseline-still-learning
hypothesis.

So the remaining step is a production re-derive or a replay harness, each its own entry. Verifying
the entry rather than implementing it is what this session could add — and it found something the
entry does not describe.

## The two regimes reproduce exactly, and there is a third

The table verifies to the day: 16 days at level 5 (2026-07-24 → 2026-08-29, mean confidence
0.464, `daytime_stress_coverage_min` NULL on all — the column's age, as the entry's own ⚠ says),
and 14 days at levels 1–4 (2026-09-07 → 2026-09-22).

**Resilience has published nothing since 2026-09-22 — five days.** The entry ends its September
regime there and reads it as the current state. It is not.

## The rollup is fine. The gate is closed.

`oura_daily_derived` was last written **2026-09-27 02:19 UTC** and `daytime_stress_coverage_min`
is populated through **2026-09-27**. The rollup runs, computes coverage, and declines to publish
a level.

The mechanism needs no replay — it is two constants and the stored coverage column, which exists
precisely so "why did resilience produce nothing today" is answerable from data:

- a day is valid only at `resolutionMinutes × nonNaN ≥ minDaytimeStressHours × 60`
  (`stress-resilience.ts:144`) → **240 minutes**;
- a level publishes only at `validCount >= windowMinLength` (`:288`) → **5** of a 14-day window.

Coverage from 09-15: **290, 290, 170, 170, 120, 50, 150, 60, 150, 60, 140, 110, 50**. Two of the
last thirteen days clear 240. On 09-22 `confidence` was **0.357, which is exactly 5/14** — sitting
on the floor. On 09-23 the window rolled past one more valid day, `validCount` hit 4, and the gate
closed.

**Coverage alone does not explain it, which is worth stating because it looks like it should.**
09-21 published a level at 150 minutes and 09-23 published nothing at the same 150. The per-day
number is not the gate; the count of valid days in the trailing window is.

## What this changes about TN-70

The September spread was **already decaying to the floor as it was being measured**. Confidence
across 09-07 → 09-22 falls to the minimum and then through it. Reading those fourteen days as a
healthy regime to contrast against the level-5 one overstates them.

It does **not** explain the level-5 regime, and is not offered as doing so. It is a separate,
later fault on the same metric.

## Filed as LA-158

A score the owner reads simply stopped, and the only reason anyone knows is that someone queried
the table — no Known-Issues row, no surface saying "not enough daytime coverage to compute this",
no alert. The absence is indistinguishable from the app not having got to it yet.

Two candidate causes for the coverage collapse, **neither established**: the ring is genuinely
worn less in the daytime since mid-September, or daytime-stress ingest has degraded. The database
cannot separate them — `worn_hours_ble` is NULL on every row (TN-70's own finding), so there is no
stored wear figure to check against. That half is a `DV` question.

**The entry says outright not to fix it by lowering the gate.** Four hours is the vendor model's
own constant, and a level computed from 50 minutes of coverage would be worse than no level.

## Not exercised

**No code changed and nothing was run.** Every figure is a read of `claude_ro` against production,
and every threshold is quoted from source with its line. The decisive re-run TN-70 asks for is
still not done and still blocked for the reasons already recorded there.

**Both reads are row-scoped to the owner**, like every `claude_ro` view, so these are his days.

<a id="2026-09-27-tn74-deload-estimate-predicate"></a>

# TN-74 — the "dead field" was load-bearing offline, and the real defect was underneath it

**Branch:** `lane-a/tn74-deload-estimate-predicate` · **Lane A**.

## The trap

TN-74's remaining item 2 read: *"`target80` is an accepted input that silently does nothing…
Either drop it from the schema or honour it."* The server half is exactly right —
`log-exercise.ts:224` destructures `target80` from `estimateOneRm`, shadowing the payload field.

It is false of the device. `sqlite-backend.ts:459-460` writes `payload.estimated1rm` and
`payload.target80` straight into the local `exercise_logs` row, under its own comment *"use
client-provided offline estimate if present"*. **Taking either remedy the entry offered would have
removed the 1RM from every offline-logged exercise on the device until it synced** — on the
offline-first path, which is the canonical runtime.

The field is not dead. It is read by a different consumer than the one the entry looked at.

## The real defect, which is fixed

Looking for who supplies that offline value turned up the actual problem: the predicate deciding
whether an exercise's 1RM estimate is suppressed existed in **two copies**.

- `packages/shared/src/workout/log-exercise.ts:218` — server
- `components/workout-screen.tsx:1224` — client, and this one decides what the device stores
  offline

Both computed `exerciseDeloaded === true || (isAnyDeload && !isBaseline)`. **They agreed**, which
is why nothing had broken and why a reader would pass over it.

They are one function now — `isDeloadedForEstimate`, exported from the shared module and called
from both.

**Why it earns a change despite the two copies agreeing.** `estimated_1rm > 0` **is** the deload
test (`adapter.ts:1482`), not a proxy for one. A drift between the copies would not surface as a
wrong number on a screen; it would surface as an offline-logged exercise disagreeing with the
server about whether a deload happened at all — on the field that encodes the answer.

## The mistake this cost, and the gate that was missing

The predicate first went into `packages/shared/src/workout/log-exercise.ts`, beside the server
call that used it, and the client imported it from there. `tsc` passed. **CI's Build did not**,
and the import trace says why:

```
./lib/data/postgres/adapter.ts → ./lib/data/index.ts
→ ./packages/shared/src/workout/log-exercise.ts → ./components/workout-screen.tsx
```

`log-exercise.ts` reaches the repository, which reaches the Postgres adapter, which reaches
`onnxruntime-node` — so importing it from a client component pulls a **native binary into the
browser bundle**. Being under `packages/shared/` does not make a module client-safe, and
**typecheck cannot tell you**: the types resolve perfectly. Only the bundler knows.

It now lives in `packages/shared/src/1rm.ts`, which has **no imports at all** — a true leaf, and
already the home of `estimateOneRm`, whose `deloaded` argument this computes.

**The gate I skipped was `pnpm build`.** For anything that adds a client-side import of a shared
module, typecheck plus tests is not enough, and this is the one failure mode where local green and
CI red are guaranteed rather than unlucky.

## Verification

- New test, **6 cases**: per-exercise deload, session/phase deload with no per-exercise flag
  (the Q-298 case), the baseline carve-out, the asymmetry that a baseline does **not** override an
  explicit per-exercise deload, the all-false case, and `undefined` reading as false.
- **Mutation pass: baseline survives, 3 killed, 1 equivalent control survives.** Killed: `||`→`&&`;
  dropping the baseline exemption; making `isBaseline` override the per-exercise flag too (the
  tempting simplification). Control: `=== true` → truthy.
- `tsc` clean; **`pnpm build` clean** (the check that caught the first attempt); `check-test-typecheck` 316/87, none above baseline; Custom Rules **82 of 82**.
- `packages/shared/src/workout` + `packages/shared/src/__tests__`: **649 passed (49 files)**.

## Not exercised

No device run — and this is the one change in a while where that matters, because the copy being
replaced is the client's, and the behaviour it governs is what the device stores **offline**. The
two expressions are textually identical and the test pins the truth table, so the risk is low, but
the offline log path itself was not exercised on the phone. `pnpm dev` cannot reach it:
`getLocalStore` returns null in the web sandbox.

## Still open on TN-74

Item 1 only: four zero-1RM rows whose `target_80` was set by some later write path, 6–7 hours
after logging. Which path is still not established. Repairing the historical rows remains the
owner's call, as the entry says.

<a id="2026-09-27-tn75-coverage-decomposition"></a>

# TN-75 — the coverage "regression" is three causes, and two of them are not defects

**Branch:** `lane-a/tn75-coverage-decomposition` · **Lane A** · docs-only.

## What I set out to do

TN-75 reports `planned_pct` coverage falling from 93% in August to 72% in September, with the
acceptance criterion *"September-onward coverage returns to August's level or better"*. I picked it
up to fix the write path. Re-measuring first — which is the standing rule — showed there is no
single write-path fault to fix.

## The measurement

Re-measured on more data than the filing had: **172 September sets, 71.5%**, so it is not
recovering on its own. **49 sets lack a plan, and all 49 are now accounted for:**

| cause | sets | what it is |
|---|---:|---|
| Bodyweight exercises | **23** | Chin-Up, Pull-Up, Hanging Leg Raise |
| The 09-06 → 09-12 window | **20** | five sessions, one set per exercise, no plan on any |
| Barbell Skull Crusher | **6** | no `style_id`, so no per-set percentages exist to record |

Splitting loaded from bodyweight inverts the headline. August: loaded **233/233 = 100%**. September:
loaded **121/147 = 82.3%**, bodyweight **2/25 = 8%**. Most of the drop is a change in what was
*trained*, not in what was *recorded* — with a real, smaller loaded regression underneath.

## Two hypotheses of mine, both killed by the data

1. **"It is just the bodyweight mix."** No. Loaded coverage itself fell from 100% to 82.3%. Had I
   stopped at the first split I would have closed this as a non-finding.
2. **"The residue is sets performed beyond the prescribed count."** No. On 09-19 the same **one**
   exercise is unplanned at set 1, set 2 *and* set 3 (4/3, 4/3, 4/3). That is the per-exercise shape
   the entry measured originally — the entry was right and my tidier explanation was wrong.

## A correction to the entry

Its proposed signature for the five-session hole — *"all carry `intensity_mode` NULL where the 2–6
September sessions carry `'deload'`"* — is true and **does not discriminate**: every session from
09-13 to 09-24 also carries NULL, and all of them have full coverage. `was_override` does not
separate them either. What does: **the window logged exactly one set per exercise** (3/3, 5/5, 4/4,
4/4, 4/4) against two per exercise on every healthy day.

## The find worth the session

**The entire loaded residue is one exercise.** Barbell Skull Crusher, 6 sets, `style_id` NULL where
every planned exercise has one — and it is the same exercise, in the same 09-25 Upper session, that
BF-200 was filed for: the owner reporting that Skull Crusher alone ignored a deload. A missing
per-exercise prescription link would explain both. BF-200 now carries that note, so whoever takes it
checks one cause instead of chasing two.

## What is left

One question — what happened in 09-06 → 09-12. Session metadata is uniform across the boundary, so
the database does not hold the answer; it needs the deploy history for those dates.

And one **product** question rather than a defect, tagged `Lane: O`: should a bodyweight exercise
carry a plan at all? `planned_pct` is a percentage of a 1RM those movements do not have. Until it is
decided, adherence coverage should be quoted over loaded sets only — otherwise every future figure
has 23 structurally-unplannable sets in its denominator.

## Verification

Docs-only, no code. `check-backlog-pointers` OK (541 entries), Custom Rules **80 of 80**.

**Not exercised:** nothing runtime — there is none here. Production was read, never written.

<a id="2026-09-27-tn78-moderate-intensity-floor"></a>

# TN-78 — the moderate floor moves to 40% HRR, and the entry's impact figure was a different quantity

**Branch:** `lane-a/tn78-moderate-intensity-floor` · **Lane A**.

## What shipped

A dedicated `MODERATE_INTENSITY_FRAC = 0.4` with `moderateIntensityBpm()`, consumed by a new
`activeMinutesFromReadings`. **`ZONE_DEFS` is untouched** — and that is the whole story below.

The defect is a taxonomy splice. `DEFAULT_ZONE_MINUTES_GOAL = 22` cites WHO's ≥150 min/wk of
**moderate** activity, and `activeMinutesFromZoneSeconds` scores that goal off the Light band —
whose floor sat at 60% of heart-rate reserve, where ACSM puts **vigorous**. The target was
moderate and the bar was vigorous, so brisk walking could not earn a single minute.

## The re-score, and the correction that came with it

The Tuning rule says a proposal is incomplete without stating how many days move, so I measured
it by replicating `accumulateZoneSeconds` in SQL — 120-second gap cap included — over
`oura_heartrate`, the table `getHrForWindow` actually reads.

| | old floor (134 bpm) | new floor (108 bpm) |
|---|---:|---:|
| days **meeting** the 22-minute goal | **1** of 32 | **3** of 32 |
| mean active minutes/day | **0.9** | **4.9** |
| days with **any** time above the floor | 3 | 24 |

The entry said *"the owner hit the old floor on 3 of 31 days and hits the new one on 24"*. That
pair reproduces **exactly** — and it is the bottom row. Days with any qualifying time, not goal
attainment. A correct measurement labelled as a different thing, which is the same failure mode
four other entries have shown this week.

## What that retracts

The entry's second warning said `DEFAULT_ZONE_MINUTES_GOAL = 22` "will be met most days and is
probably too low" at 40%, and instructed the implementer to measure it and file a re-size. **It is
met on 3 of 32 days, mean 4.9 minutes.** The prediction is inverted, so the re-size entry is
deliberately **not** filed — acting on it would have moved the goal the wrong way. Whether 22 is
the right number is a separate question needing its own measurement.

## The implementation the entry named is a regression, and CI caught it

The entry says to change `ZONE_DEFS` Light `lowerFrac` to 0.4. I did that first, ran
`packages/shared/src/health`, got 1070 green, and pushed.

`hr-targets.test.ts` failed: **expected 134, got 106**. `targetsForRunType` builds run
prescriptions from the same zone map, so widening Light takes a **recovery run's ceiling from
134 bpm down to 106** with it. The owner approved a change to how active minutes are *counted*,
not to what a recovery run is — and nothing in the entry mentions the coupling.

One map, two uses that want different edges: an activity-guideline definition and a training
prescription. So the moderate floor is its own constant, the zone map is left alone, and a test
now pins that the Light band still reads 134 — with the reverted mutant (`Light → 0.4`) in the
mutation pass, because that is the mistake a future reader is most likely to repeat.

**What let it through locally:** I ran the suite for the directory I edited. The consumer was one
directory over. `packages/shared/src/running` was never in the command.

## Why ship it anyway, given the small effect

The day count was never the defect. A WHO moderate target scored where ACSM starts vigorous is
wrong as a definition, and it made a whole class of real activity invisible. The effect being
small is a fact about how much the owner walks, not evidence the threshold was fine.

## Verification

- `packages/shared/src/health` + `packages/shared/src/running` + `lib/health`: **1272 passed / 27 skipped (129 files)** — the running suite is in the command now, deliberately.
- New test pins the band **between** the two floors (120 bpm); that it counts **once** rather
  than doubling like zones 3+; the floor inclusive at 106 and excluding 105; the 120-second gap
  cap; **that the Light band still reads 134**; and **that a recovery run's ceiling is unmoved**.
  The two pre-existing zone tests use readings clear of the boundary and passed either way — worth
  saying, because a green suite was not evidence here.
- **Mutation pass: baseline survives, 4 killed, 1 equivalent control survives.** Killed: the
  moderate fraction back to 0.6; **moving the Light band to 0.4 (the regression above)**; counting
  vigorous once instead of double; an exclusive floor. Control: `vigorousFloor <= bpm` reordered.
- `tsc` clean; Custom Rules **82 of 82**; v1.477.8 with a changelog line (user-visible: every past day's zone minutes change).

## Not exercised

**No device run.** Zone minutes appear on the Activity surfaces and this changes what every past
day reads there, which is exactly the kind of change the phone should confirm. TN-78 keeps that.

<a id="2026-09-27-tn79-gate-read"></a>

# TN-79 — the read it asked for, and the prediction it refutes

**Branch:** `lane-a/tn79-gate-read` · **Lane A** · docs-only.

TN-79 ended with an explicit instruction: *"The next step is therefore a READ, not a code change:
after this deploys, check whether the 21 days read `scorer_no_output`."* This is that read.

## They do not

| day | gate | written |
|---|---|---|
| 2026-09-16 → 09-24 | `insufficient_met` | 09-27 03:21 |
| 2026-09-25, 09-26 | `scorer_no_output` | 09-27 03:21 |
| 2026-09-27 | `insufficient_met` | 09-27 03:21 |

**All twelve rows carry the same `updated_at`**, so none is a leftover from before the split — every
one is a fresh verdict. The new string is live and reaching the table, which is itself worth
knowing: the `scorer_no_output` change deployed and works.

But it fires on **2 of 12** days. On the other ten the MET floors are firing — and 09-18 → 09-24
are precisely the days TN-79's own replay proved clear **both** floors with room (09-23: a
1421-minute grid, 1073 valid minutes, against 720 and 360).

**So the conditional the entry set up does not trigger.** It said that if the days read
`scorer_no_output`, the question becomes whether the model constants load in the serving process.
They don't, so that is not the next question, and a session that starts from the entry's last line
would chase the wrong thing.

## What the read establishes

Same frames, same `metGridFromDaytimeSamples`, opposite verdicts — the only difference is that the
replay reads `oura_raw_samples` directly while production reaches it through
`getOuraDaytimeSignals`. The loss is inside that method. That is where TN-79 already suspected it;
what is new is that it is now demonstrated rather than inferred, and that the scorer is exonerated
on ten of twelve days.

## Two hypotheses formed and killed, so nobody re-runs them

1. **"Every MET value in a `0x50` frame is pushed with the same `tsMs`, so a day collapses to ~100
   distinct minutes."** The timestamps genuinely are shared — `getOuraDaytimeSignals` pushes each
   decoded value with its frame's `tsMs`. It is still not the cause:
   `metGridFromDaytimeSamples` regroups consecutive equal-timestamp bins into their source event
   and lays them out one minute apart. That is what the function is *for*. I formed this one and
   the code disproved it before it cost anything.
2. **"`readRawFrames` truncates."** No `LIMIT` exists anywhere in it, hot tier or cold.

## What is left

Two candidates, both inside `getOuraDaytimeSignals`: the ds window from `msToDs` on the day bounds
(LA-139/RV-182 ② moved this onto a robust offset across the whole anchor series, and the window is
only as good as that fit), or **rows silently dropped by `dsToMs` returning null** — `if (tsMs ==
null) continue` discards a frame with no signal at all.

**They cannot be separated from outside, because nothing persisted says how long the grid was.**
So the next step is instrumentation rather than a third read, filed as **LA-161**: two nullable
integer columns carrying the grid length and valid-minute count the gate actually evaluated. One
migration, ships alone, additive.

This is the same move that produced today's result — TN-79 spent one string on `scorer_no_output`
and got an answer in two days. Two integers should end the question.

## Verification

Docs-only. `check-backlog-pointers` OK (542 entries), Custom Rules **80 of 80**.

**Not exercised:** no code changed. Production was read, never written.

<a id="2026-09-27-walk-exit-prompt"></a>

# LB-141 — the back gesture asks now, and only one of the two exits was ever real

**Branch:** `feat/walk-exit-prompt` · **Lane B** · `lib/stores/**`, `components/guided-walk/**`,
`components/shell/**`.

Leaving a guided walk by anything other than the End button called `reset()` and kept nothing, at
any duration — walking away from a 39-minute walk discarded it. The owner answered this on
2026-09-26: **prompt on both**, save-or-discard, over the recommended silent save.

## The entry named two exits and one of them cannot fire

LB-141 was filed from a source read of the three `LeaveWalkDialog` callers. Rendered at 412 px with
an active walk seeded into the store, `/activity/guided-walk` has **zero `nav` elements** and offers
exactly one exit, `End walk`. `BottomNav` is mounted by `tab-shell.tsx`; the walk is its own route
outside that shell, so the component's `pathname.startsWith('/activity/guided-walk')` guard is never
true while it is on screen. **The tab-bar exit discards nothing today.**

So the real subject of this entry is the **hardware back gesture**, which is global and does fire.
`e2e/lb141-walk-exit-prompt.spec.ts` pins the reachability fact, with a failure message naming what
to do on the day it changes; whether the walk should be immersive at all is filed as **LB-174**,
`Lane: O`, with a recommendation.

## What shipped

A `'choose'` shape on `LeaveWalkDialog` — three stacked buttons, save first — behind a discriminated
union, so a caller cannot offer the choice without wiring the save. Under `MIN_WALK_SEC` both exits
fall back to the same `'discard'` confirm the End button already shows (BF-191), rather than
offering to save a walk too short to record. Rendered at 384 px: 336×48 each, dialog 300 px tall.

**Save could not be one call, which is the part worth knowing.** The walk's HR samples and cadence
live in `WalkActive`'s refs and the row is written by `WalkSummary`'s **mount** — neither is
reachable from a shell-level handler. Flipping `mode` to `'done'` from out there would read as a
save and write nothing, and `onRehydrateStorage` resets a `'done'` walk on the next load, so it
would not even survive. So the exits set `finishRequested` on the store and the walk screen runs its
own `endWalk`; **Save therefore stays on the walk and lands on the summary rather than going where
the user tapped**, because the summary is both the write and the confirmation it happened. The flag
is cleared before `endWalk` (which unmounts the watcher) and on rehydration (a stored `true` would
end the next walk on launch).

`MIN_WALK_SEC` moved to the store beside a new `walkElapsedSec` — three places now compare against
that floor and must agree, and importing `walk-active.tsx` into the shell would pull the whole walk
screen into every route's bundle for one integer.

## A guard that pinned the old policy

`bf190-bf191-walk-end.test.ts` asserted `outcome="discard"` at both exits — the exact behaviour the
owner changed. It now asserts what BF-191 actually guarantees (one prompt; no offer to save below
the floor) plus LB-141's own shape, and both still hold. Two smaller edits came from the same file:
the early-exit call moved to `elapsedRef.current` so the finish-request effect stays stable, and the
regex that reads the save handler accepts the shell's `requestWalkFinish` alias — a property, not a
name.

Both call sites render **two elements on a ternary** rather than one with conditional spread props.
That is deliberate: a spread hides `outcome=` from the source guard that exists to stop a caller
inheriting a default, and loosening the guard to fit my code is the wrong direction.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors · full unit suite green · build clean ·
`bf190-bf191-walk-end.test.ts` 11/11 · the reachability spec green.

**Not exercised — the prompt itself.** The back gesture is a Capacitor `backButton` listener with no
web equivalent, so nothing here presses it. The dialog was rendered at 384 px by temporarily
loosening the tab-bar guard, capturing, and reverting (`git diff` clean) — a different trigger
reaching the same component, which is evidence about the component and not about the gesture. The
save path in particular writes through `WalkSummary`, and `getLocalStore` returns null in the
sandbox, so the branch that writes the row is one a browser here cannot reach. A Known-Issues row
states the pass test on the S25.

<a id="2026-09-28-ble-view-offset"></a>

# BF-216 — read the view, not its buffer

**Branch:** `fix/ble-view-offset` · **Lane B** · `components/settings/**`.

`BleClient.read` resolves a `DataView`. `.buffer` is the whole backing `ArrayBuffer`, so it discards
`byteOffset` and `byteLength`: a view into a pooled or offset buffer hands back a byte belonging to
something else. The pairing screen stored that as a battery percentage, in the same store the Home
chip reads — so a wrong value there would have presented as BF-215's symptom with a different cause.

**Latent, not live.** `@capacitor-community/bluetooth-le` builds each `DataView` on a fresh buffer
today, so the offset is 0 and the old read happened to be right. That is a property of the plugin's
implementation rather than of the API contract, and one version bump from changing quietly.

## The entry named two sites; the same shape is on three more

| site | lane |
|---|---|
| `chest-strap-pairing.tsx` battery + firmware | **fixed here** |
| `lib/colmi-ble/ble.ts:180` — the V1 notification frame | Lane A |
| `lib/colmi-ble/ble.ts:190` — the V2 big-data chunk | Lane A |
| `lib/live-hr/chest-strap-source.ts:233` — **the live HR measurement** | Lane A |

All three take a `DataView` from the BLE plugin and read `.buffer`, so all three carry this defect.
They are **device pipelines**, which §3 of the agents contract puts in Lane A, so BF-216 is re-laned
to `A` with only those left. `ble.ts:215`'s write path is not in scope: it builds its own array
rather than receiving one, so it owns the buffer it reads.

The guard names those two files and **fails if one stops matching**, so fixing a site means striking
it from the list in the same commit — the reminder rather than a chore. An exemption that keeps debt
visible beats one that makes it look clean.

## The guard demonstrates the defect

Rather than asserting a style, it builds `new DataView(backing, 2, 1)` and shows the two reads
disagree: `.buffer` returns the filler byte, `getUint8(0)` returns the real one. Same for
`TextDecoder`, which honours a view and over-reads its buffer. A third case pins the behaviour the
fix had to preserve — `getUint8(0)` throws `RangeError` on a zero-length view where `[0] ?? null`
yielded null, which is why the read is guarded on `byteLength`.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors · full unit suite green · build clean.
**Control-run:** the scan half fails against `origin/main`; the three behavioural cases pass either
way, which is correct — they are about JavaScript's semantics, not this repo's source.

**Not exercised:** the device, and nothing visible changed. The value rendered today is identical by
construction, which is exactly why the sandbox cannot tell the two reads apart, and the path only
runs while pairing a real H10 over BLE. A Known-Issues row states the pass test.
