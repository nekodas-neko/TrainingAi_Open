# Session journal — batch folded 2026-09-14

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-10-chore-or-105-premature-verify"></a>

# 2026-09-10 — five entries were filed as shipped and never built (OR-105)

**Branch:** `chore/or-105-premature-verify` · queue fields only. No product code.

## What a premature `Verify:` costs

`next-item.js` reads `Verify:` as **shipped — a look is owed, nothing is blocked**. An entry that
carries one while its work is unwritten is therefore filed where nobody looks: not in READY, where an
implementer would take it, and not in PARKED, where a reason is printed and invites a question. This
is the defect that hid the reta tracker's entire surface for two days (OR-102b).

## The method, after two guesses that did not work

**"Carries a `Verify:` with no `Branch:`"** over-caught — it flags every shipped entry that simply
never recorded a branch, which is most of them.

**"No commit mentions the id"** was wrong too; every one of the eighteen had a mention.

What discriminates: **does any commit mentioning the id also touch a non-docs file?** A filing commit
only touches `docs/`. Nine of eighteen had none.

**That still over-catches, and checking is what settled it.** RV-38 has no code-touching commit, yet
`components/body-battery-card.tsx` carries a real `battery.hasData` branch — it shipped. So each
candidate got one targeted grep for the thing it claims.

## Five proven unbuilt, now READY again

| entry | what proves it |
|---|---|
| **RV-40** | neither named route contains `invalidUuidResponse` |
| **RV-44** | longhand `proteinG * 4 + carbsG * 4 + fatG * 9` still in `scan-totals.ts:41` and `meal-split.ts:189`; `atwater.ts` appears only in comments |
| **RV-41** | `lib/coach/patch.ts` imports nothing from the targets or goals routes and declares no bounds |
| **RV-36** | `app/nutrition/nutrition-content.tsx` has no scroll-restoration reference at all |
| **RV-42** | `replaceMealPlanStructure` checks `ownedPlan` for the plan, then inserts `mealTypeId` and `savedMealId` from input unchecked |

Lane A READY 13 → 16, Lane B 2 → 3. Each carries the proof line, so the next session can check or
refute it in seconds rather than re-deriving the verdict.

**RV-42 is worth reading on its own** — it is a cross-account write path, not a cosmetic gap, and it
has been sitting under "nothing is blocked" since it was filed.

## What was deliberately NOT done

**No `Branch:` was added to the nine entries that had shipped**, though that is the obvious way to
stop the scan re-flagging them. The commit the scan finds is frequently an **incidental mention**:
PS-24's top hit is OR-102a's commit, BF-53's is PS-39's, BF-96's is BF-116's. A wrong `Branch:` is
worse than an absent one, because the next scan trusts it.

## Still unresolved (3)

- **RV-39** — the ring card's real state is BLE, which the web build cannot reach; neither the code
  nor the sandbox can settle it.
- **BF-119** — the store says *"never auto-resume a stale active"* and the screen says *"no
  pause/resume"*, which neither confirms nor refutes a loss of samples across a process kill.
- **LA-57** — carries **⛔ REFUTED** in its heading *and* a `Verify: device`. A refuted finding owing
  a device check is a contradiction; someone has to decide whether it is a live question.

**Surfaces not exercised:** none apply — queue fields only; no runtime code, no device path, no
schema. `pnpm check:rules` **Ran 73 of 73**.

<a id="2026-09-10-chore-or-106-queue-sweep"></a>

# 2026-09-10 — the queue sweep: a starved lane, a gate that overreached, and a batch that was refused

**Branch:** `chore/or-106-queue-sweep` · queue fields and docs only · no product code.

## Why

Lane B's READY list was **empty** — the same complaint that opened this run of Orchestrator work, back
after the reta tracker shipped. A full pass over all 337 entries, asking three questions: what can be
cleaned up, what can be given a lane, and what can ship as one PR.

## Lane B was starved by two entries, and only one of them deserved to be

**PS-35 → PS-35a / PS-35b.** The entry carried `Gate: owner for the page deletions` — a gate that
prose scoped to *one* of its five parts. `next-item.js` reads `Gate:` as a property of the whole
entry, so a decision about deleting five redirect pages was also parking a wrong PWA `start_url`, a
boot warm that re-fetches home's three heaviest requests (**measured ×2 on Fast-3G**), a dead
rehydrate branch, and a weather chip that pulses forever with an unkeyed cache. None of those four
needs an owner. **This is the same defect the `Lane:` field exists for — a label that lives only in
prose.** The gate now sits on PS-35a alone.

**RV-37's gate was answering a different question than the one it blocked.** `/health/day`'s scroll
container is `flex-1 space-y-4 overflow-y-auto scrollbar-hide px-4 pt-4` — no bottom padding at all,
read from source. The entry gated the fix on a device check. But two questions were being answered as
one: *"should a fifth safe-area CI rule exist?"* genuinely needs evidence and stays open; *"should
this one container have bottom padding?"* does not, because a full-height scroller ending flush with
the gesture bar is a defect by CLAUDE.md's own rule, and `/more` already shows the shape to match
(`pb-nav-safe`, 68 px). Fix, then look — the device check moved after the work instead of in front.

**Lane B READY: 0 → 2.** The other ten Lane B parks were checked and left: BF-110 (a Samsung WebView
compositor failure Chrome cannot show), BF-111 (a card that returns early off-native), BF-94, LB-36,
Q-529, PS-10, Q-516, BF-126 are all correctly gated.

## Lanes: 25 tagged, and a shortcut that would have been wrong

Every TN- entry naming a path now carries a `Lane:` derived from §3 — **21 engine, 4 surface**.

**The obvious bulk rule was tried and is wrong.** *"TN- is Tuning, Tuning is scoring, scoring is Lane
A"* would have mis-tagged 4 of 32: TN-19 is `components/body-battery-card.tsx`, TN-28 is
`components/nutrition`, TN-12 and TN-3b likewise surface-only. A blanket tag sends work to the wrong
agent silently, which is precisely what `scripts/lib/lane.js` exists to prevent. Each was derived
from the paths it names.

Those 4 matter more than their count: TN-12, TN-19 and TN-3b were **invisible to Lane B**, and now
print there with their real blocker next to them — a `Needs:` on a Lane A engine half. Which is the
structural finding: **Lane B starves when Lane A is the bottleneck**, because the engine-first rule
puts B's work behind A's.

## Batching: nothing qualifies, and that is the answer

The rule is *aggregate on what has to be **verified**, never on subject*. Five subject clusters were
tested and every one fails for a concrete reason:

| cluster | why not |
|---|---|
| injury-aware (BF-44 + BF-68) | **tried it — the checker refused it.** Different lanes, and BF-68 is shipped residue |
| Body Battery (TN-2/15/19, Q-521) | 3 parked, 1 in the other lane — you cannot batch across a park |
| weight goal (LB-42/96/97) | LB-42 is migration 246; the rule forbids batching a migration |
| activity factor (BF-102 + LB-50) | already sequenced by `Needs:`, which is the A-then-B split, not a batch |
| hourly movement | spans both lanes |

The one I actually attempted, `injury-aware-surfaces`, was **rejected by
`check-backlog-pointers.js`**: *"a batch ships as one PR and a PR is one lane's work."* The tool was
right and the proposal was wrong — BF-68 had already shipped, and my throwaway parser missed it
because that entry writes `**Keep —**` rather than `**Keep:**`. `next-item.js` handles both correctly
via `lib/keep.js`; only my scratch script did not, so there is no repo defect here.

## The lane count in the first draft of this entry was wrong

An earlier version of this write-up, and of OR-106, said **90 entries state no lane** and that
coverage had gone 68% → 82%. Both numbers came from a throwaway regex in a scratch script,
`/\*\*Lane:?\*\*/`, which requires the colon *outside* the bold. Many entries write `- **Lane: A**`
with it inside. `scripts/lib/lane.js` reads both — that is the whole reason the module exists — so
the scratch script disagreed with the shipped parser and the scratch script lost.

**The real figure is 16 of 340, and coverage is 96% (August) / 94% (September) — flat.** Cross-checked
against `next-item.js`'s own `⟨lane unstated⟩` marker, which independently names 16.

**None of the 16 is startable work**: nine `Verify:`, one `Keep:`, one `Reference:`, five parked. So
the 25 tags this PR does add are worth having, but they close a gap that was never 115 wide, and the
follow-up OR-106 asks for is now *small and conditional* rather than a sweep.

**The lesson, written into OR-106:** measure lane coverage with `laneFromLines()`, never a fresh
regex. A parser exists precisely because the field has more than one written form.

## Not done

- **16 entries state no lane**, none of them startable work — see the correction above. Filed as
  **OR-106**, which now says to add a lane when each is next touched rather than sweeping for it.
- **Q-395 is 300 lines of shipped spec sitting in the queue file** — every phase has landed and what
  remains is a completion checkpoint. It belongs in `docs/` with a short entry pointing at it. Not
  done here because moving it is a judgement about where the spec should live, and this PR was
  already large. The backlog is at 20,349 lines against a ceiling that has blocked PRs before.
- The device gates listed above are unchanged and still owed.

**Surfaces not exercised:** none apply — queue fields and docs only; no runtime code, no device path,
no schema.

<a id="2026-09-10-chore-or-107-entries-ceiling"></a>

# 2026-09-10 — the journal ceiling counts entries nobody is allowed to fold (OR-107)

**Branch:** `chore/or-107-entries-ceiling` · one config number, one comment, one queue entry.

## The bind

`docs/overview/entries/` is meant to be a readable *recent* window, and two rules make that
impossible together:

- The entries README says **do not fold an entry another doc links to.** That rule is right — it was
  adopted after a sweep broke 48 links, several inside another lane's baton, which is not a file a
  sweep should be rewriting.
- **305 of 342 entries are cited** by a durable doc. `projectOverview.md` pins 198,
  `docs/implementation-backlog.md` 98, the domain READMEs most of the rest: 30 files, 467 links.

So the only entries a sweep is permitted to fold are the **newest** ones, and satisfying a ceiling on
the *total* means deleting the recent window to preserve the archive — backwards from what the window
is for. I did exactly that earlier today to unblock a PR: folded 20 entries from the previous two
days, because nothing older was foldable.

## Why raising the number is the right call and not a dodge

The check already carries two gates, and only one of them names an action a person can take:

| gate | counts | at | can it be satisfied? |
|---|---|---|---|
| `limit` 60 | **foldable** entries | 37 | yes — fold unlinked ones |
| `totalCeiling` 361 | **every** entry | 342 | no — 305 are unfoldable by policy |

The foldable limit is the working gate and it is healthy. The total ceiling measures something no
sanctioned action can reduce, so it fires as a tax on whichever PR happens to be open — **two
unrelated PRs in two days**, both mine, neither touching the journal. And at **~13.5 new entries a
day** no fixed total survives a week regardless of where it is set.

Raised to **600** and reframed in `check-doc-index-size.js` as a backstop against pathological growth
rather than a compaction trigger, with the reasoning in the file so it is not quietly lowered again.

## The actual fix, filed rather than improvised

**OR-107**: make folding **rewrite the citation** instead of refusing to fold. An entry moves into
`history-*.md` under a stable anchor and every `](entries/docs/overview/entries/<name>.md)` becomes
`](entries/docs/overview/history-<file>.md#<anchor>)`. Then "linked" stops meaning "unfoldable" and the window
sheds oldest-first. The form is regular enough to script — 194 of projectOverview's citations are
literally `[journal](entries/docs/overview/entries/<name>.md)`.

**It is filed, not built, deliberately.** The README documents **five** measured link-breaking traps
from previous attempts, each found by a separate `check-doc-links` run, each looking like the last
thing that could be wrong. A change that rewrites 300+ links across 30 files — including other lanes'
batons — is a planned piece of work, not something to improvise at the end of a sweep. The entry
points at all five by name so the next session does not rediscover them one run at a time.

## Not done

- The fold itself. OR-107 is queued, Lane O.
- The 37 currently-foldable entries are left alone; `limit` 60 is not close.

**Surfaces not exercised:** none apply — no runtime code, no device path, no schema. `check-doc-links`
passes on 1087 files; `pnpm check:rules` **Ran 73 of 73**.

<a id="2026-09-10-dhrv-deletable-contradiction"></a>

# 2026-09-10 — a correction that left the thing it corrected in place (Q-31 / Q-50)

**PR:** `lane-a/dhrv-deletable-contradiction` · **Lane A** · docs only, nothing implemented.

## Two entries, opposite instructions, both live

Q-31's headline bullet said `inference/dhrv` is *"one Oura dependency deletable today at zero product
cost"*. Q-50 item 1 — worked earlier the same session — concludes the opposite: the module is
production-unreachable **on purpose**, its golden test is what pins D5's own regression against
Oura's original, and deleting it discards that validation while the replacement is young. **D7
decides it, not a sweep.**

Q-50 also claimed the wording *"has been corrected in the three docs that carried it."* It had not
been. Three live copies survived:

1. **Q-31's own bullet** — the entry an implementer actually works from, at position 6 in READY.
2. **`docs/domains/platform/README.md`** — the orientation read for the pillar.
3. **The triage plan itself**, which is the worst of the three: the correction sits as a ⚠️ note
   *above* the original paragraph, and the paragraph still ends *"It is the cheapest row here and
   should ship first."*

## The shape of the failure, which is the part worth keeping

**A correction placed beside the text it corrects does not correct anything — it creates two claims,
and the reader follows whichever they reach first.** In the triage plan the two are adjacent: a note
saying "do not do this" immediately followed by "do this first". Someone working Q-31 top-down reads
the bullet, opens the plan, finds a paragraph telling them to ship it first, and deletes the golden
test that validates D5.

Strike the wrong sentence. Do not annotate it. That is what this PR does in all three places, and
Q-50's own claim about the correction is amended rather than left standing as a false record of a fix.

The call-graph finding underneath was never wrong — `buildDaytimeStressSeries` genuinely has no
caller. What was wrong is the inference from it: **production-unreachable is what the retention *is*,
not evidence against it.**

## Fourth of the day, and the first that was a contradiction rather than staleness

After Q-91-followup (a claim that hid a live pre-rollup-repaint bug), Q-50 (a safety net deleted
months earlier), and Q-1a (a security precondition that inverts when you "fix" it). Those three were
stale; this one was two live claims disagreeing, which is why it survived a correction pass aimed at
staleness.

**Not exercised:** no code changed. The call-graph claim was re-checked against `main` at `efbe8ea5`;
the retention rationale is quoted from `module-map.md` and the on-device progress doc.

<a id="2026-09-10-fix-lb-54-readable-ci-logs"></a>

# 2026-09-10 — a red CI job could only say it was red; the cause was a missing `-U postgres` (LB-54)

**Branch:** `fix/lb-54-readable-ci-logs` · three lines of `ci.yml` · no product code.

## The symptom, and how long it stood

`get_job_logs` could not reach any step's output on this repo's jobs. Every retrieval — by `job_id`,
by `run_id` with `failed_only`, at `tail_lines` from 60 to 400 — returned only the post-job Postgres
service dump: thousands of lines of `role "root" does not exist`. A failed `Tests` job's entire
retrievable content was **2,797 characters, none of it vitest's**.

That cost a session on BF-111, where CI went red while the same commit ran **6,429 passed, 0 failed**
locally, and the only instrument available for telling a flake from a real failure was spending the
one permitted re-run.

## The cause

All three Postgres services in `ci.yml` ran `--health-cmd pg_isready` **with no `-U postgres`**.
`pg_isready` then connects as the container's OS user — root — which does not exist as a Postgres
role, so the server logs `FATAL: role "root" does not exist` on every probe, every 10 seconds, for
the life of the job. The runner prints that dump *after* all steps, which makes it the tail of the
log and therefore the only part `get_job_logs` can reach.

**`android-emulator.yml` has always had the `-U`.** The corrected form was already in the repo; three
jobs simply never got it.

## The first attempt turned CI red, and the reason is worth more than the fix

The comment explaining the `-U` went **inside** the `options: >-` block. That is a **folded block
scalar**: every indented line under it is folded into the value, so eight `#` lines became part of
the docker argument string. All three Postgres-backed jobs — `Tests`, `Migration Check`, `E2E` — died
in **10 to 14 seconds**, while `Lint` and `Build`, which have no Postgres service, passed.

**The file parsed as valid YAML the whole time.** My pre-push check was
`yaml.safe_load(...)`, which proves the syntax and says nothing about the value. The second attempt
checks the resolved value instead — that `services.postgres.options` starts with `--health-cmd` and
contains no `#` — and compares it byte-for-byte against `android-emulator.yml`, which has always
worked.

The tell was in the timing before it was in the logs: *only* the jobs with a Postgres service failed,
and all of them failed in seconds rather than at a test. The comment now sits above the key and warns
the next reader, because the failure looks nothing like its cause.

## What is not claimed

**Whether a step's output is now retrievable needs the next genuinely red job to prove.** This
removes the documented cause of the noise, which is not the same as observing the cure — and I cannot
manufacture a red job to check. The entry says so rather than closing.

## The other half of LB-54, deliberately not done

E2E still has no green baseline on `main`: the job is gated `if: github.event_name != 'schedule'`, so
the nightly skips it and CI history cannot answer *"is this red on `main` too?"* — the first question
the CI rules say to ask.

Removing that line looks free and is not. **LB-31 chose "one job rather than six" for the nightly on
purpose**, and E2E is 26 minutes. More decisively, **LB-56 records that `main` would not pass the
suite today**, so enabling it now buys a nightly that is red from its first run — the "advisory check
decays unwatched" failure LB-56 itself warns about, at 26 CI-minutes a night.

LB-54 now carries `Needs: LB-56`, which parks it behind the decision that actually settles whether a
nightly baseline is the right instrument. The entry says why, so the next session does not make the
one-line change on the grounds that it is only one line.

**Surfaces not exercised:** none apply — CI configuration only; no runtime code, no device path, no
schema. YAML re-parsed; `pnpm check:rules` **Ran 73 of 73**.

<a id="2026-09-10-fix-vial-opened-date"></a>

# 2026-09-10 — the vial's opened date, and the half of the report it does not fix (BF-136, LB-99)

**PR:** `fix/vial-opened-date` · **Lane B** · `components/nutrition/reta/vial-sheet.tsx`,
`vial-date.ts` + `vial-opened-note.tsx` (new).

The owner: *"its saying no weights taken; but i weigh my self every day. so its been over 5 days
since first dose"*. BF-136 traced it — `vial-sheet.tsx:88` sent `openedOn: todayInTz(tz)`, a
constant, and the sheet rendered no date control. `WeightResponseCard` windows on
`p.date >= openedOn`, so a vial entered five days late drops five days of weigh-ins and the card
correctly reports that it has one.

## What shipped

- **An `Opened on` date on the sheet, defaulting to today**, bounded to `[today − 180 days, today]`.
  The POST sends it instead of the constant. Both routes already accepted the field — the backend
  was built to be told and the form never asked.
- **The bound is not decoration.** A mistyped year does not error, it moves the window, and the
  failure surfaces as a true-sounding message rather than a rejection — the shape that produced this
  report. `vial-date.ts` holds it, compared as strings because `YYYY-MM-DD` sorts in date order and
  a `new Date('2026-09-10')` here would parse as UTC midnight and shift the day west of UTC.
- **The stored date is now visible and correctable in place.**

## Correcting in place is required, not a convenience

`listSupplementVials` orders by `openedOn DESC` and the sheet reads `vials[0]`. A second vial dated
*earlier* than the wrong one therefore sorts **below** it and the card keeps using the wrong date —
so "save a new vial with the right date" is not a workaround, and without the correction control the
owner's existing vial could not be fixed from the UI at all.

The correction is deliberately separate from the new-vial form, and the form's date defaults to
**today** rather than to the current vial. The reconstitution numbers above it *are* prefilled from
the last vial because they are stable; a date is not, and inheriting it would reproduce this defect
one vial along, silently. A source test pins that.

## The report is not closed, and the entry says so

With the bug state reproduced locally — 14 daily weigh-ins, vial stamped today — the date corrected
to five days back, and `/api/body-metadata` answering with exactly the six in-window rows
(`2026-09-05 … 2026-09-10`), **`WeightResponseCard` still read "Not enough weigh-ins yet"** after six
settled seconds. The note beside it had already re-rendered as *"Measured from 5 Sept"*, so
`sinceDate` was correct and the card's own read is what did not complete.

Pre-existing and independent of this change, but it means what shipped here is **the cause, not the
observed symptom**. Filed as **LB-99** with the ruled-out branches (the payload shape matches
`WeightPoint`; the arithmetic is unit-tested) and the live suspect: the effect takes
`getLocalStore(userId)` first and only falls through to `cachedFetch` when that is null, so a web
build returning a store object rather than null would resolve `[]` and never fetch — LB-98's class,
and this would be its first live instance.

## Verification

Driven through the Playwright harness at 412 px against the local non-prod database, with the owner's
state seeded and then removed:

- The date field renders with `min=2026-03-14 max=2026-09-10`, matching `openedOnBounds` exactly.
- A future date is refused (*"cannot be opened in the future"*), and last year's is refused with
  *"check the year"*.
- The correction **PATCHed 200** and the row moved to `2026-09-05` in the database.
- The note re-rendered as *"Measured from 5 Sept, when this vial was opened."*
- The new-vial field read `2026-09-10` — today, not the corrected vial's date.

16 unit cases on the bounds and a source guard that the POST cannot go back to a constant. Full
`pnpm check:rules` — **Ran 73 of 73**.

**Not exercised:** the S25. The date control is a native `<input type="date">`, so the picker itself
is the device's and has not been opened on one; and the symptom above needs the device precisely
because the local-store branch is the suspect and the sandbox cannot take it.

<a id="2026-09-10-fix-weight-response-undecided-label"></a>

# 2026-09-10 — "not enough weigh-ins", printed above six of them (LB-99)

**PR:** `fix/weight-response-undecided-label` · **Lane B** ·
`components/nutrition/reta/weight-response-card.tsx`, `weight-response.ts`.

The second half of BF-136. Correcting the vial's opened date fixed the window and the owner's symptom
stayed: with six weigh-ins inside it, the chip still read *"Not enough weigh-ins yet"* — directly
above the card's own line reading *"6 weigh-ins over 5 days"*.

## Two opposite states shared one label

`weightResponse()` returns `null` only when there is genuinely no interval to compute: under three
readings, or no spread of days. It returns a **full result whose `verdict` is null** when there are
plenty of readings and the 95% interval straddles the band — which this card's own module doc calls
the designed normal state, *"grey with 'not enough weigh-ins yet' is the normal early state"*.

The chip was one expression:

```ts
{tone?.label ?? 'Not enough weigh-ins yet'}
```

so *undecided* rendered as *insufficient*. `responseState()` now separates the three cases and the
undecided chip reads **"Not called yet"**. Nothing about when a verdict is given changed — only what
the card says while it is withholding one.

## My first diagnosis was wrong, and the entry keeps it

When I filed LB-99 I named the `getLocalStore` fall-through and called this LB-98's first live
instance. It is not: `getLocalStore` returns null on web at `lib/local-store/index.ts:199`
(`isSQLiteAvailable()`), so the `cachedFetch` branch does run and the points did arrive. My own
ruled-out list should have implied it — the payload shape matched `WeightPoint` and the arithmetic
was already tested, which leaves the render.

The lesson is one this repo keeps relearning: **a card reporting "no data" is not evidence that no
data reached it.** Read what the component does with the data before suspecting the fetch. Q-278 and
Q-302 are the same class from the other direction — a value computed and then discarded by the
surface that asked for it.

## Verification

Unit: `responseState` is `insufficient` below three readings, `undecided` at six readings over five
days with `verdict: null` (BF-136's reproduced state, asserted as `weighIns === 6`), and `verdict`
once thirty days of steady loss commits. Plus a source guard that the label is picked from the state
rather than falling through to one string.

Rendered in the harness at 412 px against the reproduced state — six weigh-ins in the window, vial
dated five days back:

```
Weight response · since this vial
Not called yet
+0.54 kg/wk (95% CI −5.05 to +6.13, 5 days)
Your band is 0.41–0.81 kg/wk. The range crosses a boundary, so this is not called either way yet.
6 weigh-ins over 5 days. Weigh in more often to narrow this.
```

The old string is absent and the new one present. Database restored to its seeded rows afterwards.

**Not exercised:** the S25. This is WebView copy reached by a Railway deploy, but the card has not
been seen on the device, and the owner's own account is the only one with a real dosing period.

<a id="2026-09-10-home-pills-strap-battery-intake"></a>

# 2026-09-10 — Home header chips and the strap battery gauge (BugFix intake)

Two owner reports from one Home screenshot, traced to source and filed. Docs-only; no code changed.

## BF-139 — three header chips no longer fit beside the date

Q-111 shipped two battery chips into a row that already compressed badly, and wrote the risk down
at the time: whether three pills plus `EEEE d MMMM` fits at 412 dp was *"a hardware question"*.
The screenshot answers it. `header-meta-row.tsx:39` carries `overflow-hidden` as a deliberate floor,
every chip is `shrink-0 whitespace-nowrap`, and the date is the only item that can give — so at
412 dp the ~232 px left column takes ~201 px of chips and the date renders empty.

That matters because BF-96's standing instruction was *"shorten the DATE, not the chip"*. With the
date already at zero that lever is spent, which is what makes the owner's requested lever — smaller
pills — the remaining one. BF-96 and Q-111 were both amended in place rather than left to contradict
the new entry.

## BF-140 — the strap battery chip cannot go stale

The owner's read was that the app has the wrong metric. It has the right metric with a fabricated
timestamp.

The value is a genuine `0x2A19` Battery Service read (`PolarGattClient.kt:192-194`), taken once per
connection. But `PolarStrapService.battery` is assigned at `:232` and never cleared — no reset on
disconnect, none on stop — so `status()` republishes it for the life of the service process. The JS
then calls `getStatus()` on every Home mount (`use-strap-battery.ts:41`) and `writeStrapBattery`
stamps `at: Date.now()`, so the stored age measures when JS last looked rather than when the strap
last reported. `DeviceBatteryChip` only dims and only names an age past 180 minutes, so with `at`
continuously refreshed the staleness affordance can never fire. The screenshot corroborates it: full
opacity, green icon — the code believed that reading was under three hours old.

Fix shape is to carry the reading's own time from native; `writeStrapBattery` already takes a `now`
parameter that every caller omits. Clearing `battery` on disconnect alone would blank a chip whose
whole purpose is last-seen-when-disconnected.

The underlying 100% is **not** claimed to be wrong. A CR2025 discharges flat for most of its ~400 h,
so a long plateau is what a truthful gauge looks like. The point is that nothing can currently tell
the owner either way: the strap keeps one overwritten `localStorage` key and no server-side history,
against the ring's `oura_ble_battery_poll` — measured this session, **9,578 polls spanning 9%–100%**
between 2026-07-19 and 2026-09-10.

## Not exercised

Neither report was reproduced in the sandbox. The seeded DB has no weather snapshot, so `WeatherChip`
renders a skeleton and the three-chip width cannot be measured off-device; `getPolarBle()` returns
null off-device, so the strap path does not execute at all. Both entries carry `Verify: device`.
BF-139's one open question — which edge — was closed the same day: the owner confirmed the right
side, so the `overflow-hidden` clip is the cause and the `pt-safe` hypothesis is ruled out.

## BF-141 — a lb/kg toggle on the weight dial (filed later the same day)

The owner asked for a small unit toggle on the logging dial: enter in pounds for the few dumbbells
that are imperial, store the kilogram equivalent. Traced, it is prevention rather than convenience.

Session 119 (2026-06-15) records this exact failure on this exact exercise — Dumbbell Lateral
Raise, along with Preacher Curl and Shoulder Press, logged in pounds into the kilogram field,
inflating 1RM, target80, volume and personal records. The repair still exists as an admin
preview/apply tool that rescales derived figures and backdates the personal record. Nothing has
changed since to prevent a recurrence: the write payload carries no unit and `set_logs.weight_kg`
has no companion column, so a pound value validates cleanly and lands as kilograms.

The sharper argument is that the kilogram dial cannot express the hardware. It steps 1.25 kg for
non-barbell equipment, which is 2.76 lb — a grid with no pound dumbbell on it. A 20 lb dumbbell is
9.07 kg and the dial offers 8.75 or 10.00. The logged Lateral Raise history sits at 5.5–11.25 kg
across 54 sets: kilogram-grid values standing in for pound hardware.

Most of the plumbing exists — `WeightDial` already takes a `unit` prop. The conversion constant
exists too, but in the Postgres adapter, so the engine half is moving it to `packages/shared`
rather than writing a second copy.

The control was re-specified the same day. The first answer was a vertical `SegmentedTabs`, copying
the units toggle in `quantity-editor.tsx`; the owner corrected that to *"a very small button ...
something you wouldnt see or hidden in away"*, and that component is 96 px tall. The toggle is now
the `kg` suffix the dial already prints: tapping it swaps to `lb`, adding no chrome at all. It needs
the suffix split out of its bare text node, `stopPropagation` so it does not also drive the row's
select handler, and the repo's existing `.tap-dense` + `.tap-target-44` pair — otherwise the global
48 px tap-target floor inflates it into a slab, which is the failure already documented on
`switch.tsx`. `e2e/touch-target-size.spec.ts` keeps an empty allowlist, so any other approach fails
the spec.

The entry flags one hazard that would silently ruin the feature: `mround125` clamps to [5, 250], so
a 5 lb dumbbell at 2.27 kg would be floored to 5 kg. Converted values must not pass through it.

Filing this also discharged an orphaned finding. `projectOverview.md` claimed that when the dead
Kg/Lbs switch was deleted, real unit display was "filed as the feature it would actually be". It
was not — no such entry existed. That line is corrected to point at BF-141.

<a id="2026-09-10-la90-supplement-dose-merge"></a>

## 2026-09-10 — LA-90: one merge for both supplement write paths, and the live bug found beside it

Lane A. `resolveLoggedDose` in `packages/shared/src/nutrition/supplement-dose-freeze.ts`, called by
`logSupplement` (server) and `upsertSupplementLog` (local store). LA-90 leaves the queue; **LA-97 is
filed and is the more important half.**

**The divergence, confirmed against `main`.** The server merged the caller's dose against the
definition **per field** (`amount ?? defaultAmount`, same for `unit`). The local store was
**all-or-nothing**: it read the definition only when `amount`, `unit` and `doseText` were all null,
and otherwise took the caller's triple as given. A caller supplying only `amount` got the
definition's `unit` online and a null one offline — and the offline row wins, because a pushed
mutation carries what the device recorded.

**Per field is the behaviour kept**, because it is the one the server already had: sharing a merge
must not quietly re-decide what a log stores. The local store now reads the definition whenever
*any* field is missing rather than only when all are, which is what per-field needs to have
something to merge against; a caller with a complete triple — the sync engine replaying a log —
still skips the query.

**The entry's reassurance was wrong, and it is the ninth today.** It says *"the supplements page
passes no dose at all"*. `supplements-section.tsx:55` passes `{ amount, unit }` whenever there is a
prompted amount, to the local store **and** to the API fallback. The divergence still cannot fire,
but for a different reason than the entry gives: the log route and the push handler each normalise
to a complete triple before `logSupplement` sees one, and the page's `s.unit` mirrors the server's
`owns.unit`. That second half is an accident of the client holding fresh data, not a guarantee —
and it is least reliable offline, where a stale local mirror is exactly what you have.

**Mutation pass — 3 mutants, 1 control.** M1 (all-or-nothing restored — the divergence itself) →
CAUGHT, 2 tests. M2 (free text frozen against the caller's amount rather than the resolved one) →
CAUGHT, 3 tests. M3 control (returned keys reordered) → SURVIVES. The source-grep test in
`supplement-dose-chain.test.ts` was updated rather than deleted: it now pins the delegation to
`resolveLoggedDose` and forbids a local `freezableDoseText(` call, which is a stronger claim than it
made before — the free-text rule cannot be re-implemented locally without also un-sharing the merge
around it.

**The live bug found beside it, filed as LA-97 and NOT fixed here.** The same two functions drop
`takenAt` and the frozen vial triple on the way to the server. `upsertSupplementLog` freezes both at
log time (OR-102a); `enrichPayload` forwards only `amount`, `unit`, `doseText`; the server's push
branch accepts only those three; so `logSupplement` stamps `takenAt: new Date()` — **push time** —
and re-reads the **current** vial. The local code's own comment describes exactly this: *"Stamping
it server-side at push time would record whatever vial is current when sync happens, which is the
retroactive rewrite the freeze exists to prevent."* It happens one layer up, because the push path
was never extended past BF-3's three fields when OR-102a added four more.

**A third piece of the same gap, found before this PR merged and folded into LA-97.**
`getSupplementLogs` does `SELECT *` and its row→object mapper lists ten fields, none of them the
four OR-102a added — so `enrichPayload` could not forward `takenAt` or the vial triple even if it
asked. That is the root cause, and it is CLAUDE.md's own mapper rule (*"When adding a DB column,
update every row→object mapper"*, sessions 29 and 64) missed once more. It reorders LA-97's fix:
surface the fields in the reader FIRST, or the push wiring is a silent no-op that passes every test.

It is deliberately not fixed in this PR: **CLAUDE.md says a sync-push change never ships batched**,
because its revert is a corrective migration rather than a git revert. Bundling a live data bug into
a trap-fix would also have made both unreviewable, which is the same reason OR-104 left LA-90 out of
its own PR.

**One filing mistake, corrected in the same session.** LA-97's first draft used `⛔` to mark "ships
alone", and `next-item.js` parked it as *not implementable* — the exact trap this session has been
recording, walked into while writing about it. `⛔` means the entry cannot be built; a batching
constraint is neither a gate nor a blocker. Removed, and the entry now says so in prose with the
mistake on the record.

**Not exercised:** no device run. `upsertSupplementLog` cannot execute in the sandbox (native SQLite
returns null from `getLocalStore`), so the local half is verified by source-grep plus the shared
function's own behavioural tests — which is what `supplement-dose-chain.test.ts` exists for and says
about itself. The server half runs for real. No UI changed, so no screen was exercised.

<a id="2026-09-10-la97-sync-push-frozen-vial"></a>

## 2026-09-10 — LA-97: the freeze had no way to reach the server, and a correction to how I described it

Lane A, shipped alone (CLAUDE.md: never batch a sync-push change). LA-97 leaves the queue; **LA-98**
is filed for the half deliberately left out.

**⚠ First, a correction to this session's own earlier claim.** I described LA-97 as a live data bug
rewriting *"every offline supplement tick"*. The mechanism is real; **the damage so far is zero**,
and I should have measured before saying otherwise. Production holds **4 supplement logs**, the
newest 2026-09-07, and:

| | |
|---|---|
| logs with a frozen vial | **0** |
| logs with a non-null `taken_at` | **0** |
| vials in existence | **1, opened 2026-09-10** |

The first vial was created **today**, after every existing log — so no log has a frozen
reconstitution to lose. That makes this a fix landing *before* the first vialled tick rather than
after, which is a better outcome than the one I first described but not the one I claimed.

**What was broken, in four steps.** `upsertSupplementLog` freezes `takenAt` and the vial triple at
log time (OR-102a). Then:

1. **`getSupplementLogs` could not read them back.** `SELECT *` carried the columns; the row→object
   mapper listed ten fields and stopped. The freeze was **write-only**.
2. `enrichPayload` builds its push payload from that mapper, so it forwarded `amount`/`unit`/
   `doseText` and could not forward what it could not see.
3. The server's `supplement_logs` push branch accepted those same three.
4. `logSupplement` therefore re-read the **current** vial and stamped `taken_at` at **push time**.

Step 1 is the root cause and the reason it hid: it is CLAUDE.md's own mapper rule (*"when adding a
DB column, update EVERY row→object mapper"*, sessions 29 and 64) missed once more, and a missed
mapper fails silently by construction. Every test in the repo passed throughout.

**`logSupplement`'s `takenAt` fallback was already correct** — `dose?.takenAt != null ? … : new Date()`
— and still produced push-time timestamps, because nothing ever supplied one. A correct fallback
behind a caller that never calls is indistinguishable from no fallback at all, which is why three of
the four steps are upstream of it.

**#1073 widened the window while this sat.** `openedOn` is now a user-entered mix date rather than
always today, so "the newest vial by `opened_on`" can change without a new vial being entered —
a backdated mix reorders the selection a push-time re-read would land on.

**Mutation pass — 3 mutants, 1 control, one per step:** M1 (mapper reverted — the root cause) →
CAUGHT, 2 tests. M2 (server ignores the caller's vial) → CAUGHT, 2 tests. M3 (`enrichPayload` drops
`takenAt`) → CAUGHT. M4 control (`takenAt` null-check written as `== null` instead of truthily) →
SURVIVES. The behavioural tests drive the real server against local Postgres; the local half is
source-grepped, because native SQLite does not run in node — the same reason that suite exists.

**Split out as LA-98, not bundled:** `resolveLoggedDose` merges with `??`, so a replayed log whose
amount was genuinely null picks up the definition's *current* `default_amount` — the same class of
rewrite, one field over. Measured latent (1 of 4 logs has the shape, and it is long synced; the case
needs a mutation queued before a definition change and drained after). Fixing it needs three
surfaces to agree on absence and **changes web-route behaviour too**, which is not worth a second
semantic change inside a sync-push PR.

**Not exercised:** no device run, and the local half cannot execute in the sandbox
(`getLocalStore` returns null without native SQLite), so steps 1–2 are pinned by source-grep rather
than behaviour. The server half (steps 3–4) runs for real against Postgres. The end-to-end path —
tick offline, drain later, check the row kept its mix — is a **device** check and is owed; it is
the one thing here no sandbox test can stand in for.

<a id="2026-09-10-la98-absent-vs-null-dose"></a>

## 2026-09-10 — LA-98: absent and null stop meaning the same thing

Lane A. LA-98 leaves the queue; **LA-99** is filed from the evening's own friction.

**The bug, and why it is the sibling of LA-97.** `resolveLoggedDose` merged with `??`, which treats
an explicit `null` as absent. A replayed log whose amount was *genuinely* null when it was taken
therefore picked up whatever `default_amount` the definition carried at **push time** — the same
retroactive rewrite BF-3 exists to prevent, one field over from the reconstitution LA-97 fixed an
hour earlier.

**It was smaller than the entry implied, and the reason is worth recording.**
`SupplementLogSchema` already declares all three fields `.optional()` under `.strict()`, so the
parser keeps absence and null apart — `parsed.data.amount` really is `undefined` when omitted. The
distinction was destroyed *one line later* by the route's own `amount: parsed.data.amount ?? null`,
and `logSupplement` already takes `Partial<SupplementDose>`, so no signature had to change. Three
surfaces, a handful of lines:

- **`resolveLoggedDose`** — `caller?.amount !== undefined ? … : …` instead of `??`. Absent means
  "fill from the definition"; present-and-null means "none was recorded, keep it".
- **the log route** — builds a partial by conditional spread, so an omitted field stays an omitted
  key rather than becoming an explicit null.
- **the push branch** — `'amount' in p ? … : {}`, because `typeof p.amount === 'number'` answers
  "no" to both cases and cannot separate them.

**This changes web-route behaviour, and that is stated rather than buried.** A body of
`{unit: 'mg'}` used to inherit the definition's amount and now does not. No shipped caller sends a
partial body — `supplements-section.tsx` sends `{amount, unit}` together or nothing at all — so
nothing in the app moves; a future caller gets the honest reading instead of a silent fill.

**Mutation pass — 2 mutants, 1 control.** M1 (merge reverted to `??`) → CAUGHT, 3 tests including
the end-to-end replay through `pushMutations`. M2 (push branch flattens absence back to null) →
CAUGHT, 2 tests, one of them **pre-existing** — which is the useful signal, because it shows the
absence path was already load-bearing for the older-client fallback rather than something these
tests invented. M3 control (the same `!== undefined` test spelled out longhand) → SURVIVES.

**LA-99, filed from the friction rather than from a report.** Six PRs raised
`docs/doc-size/docs/implementation-backlog.md.size` within two hours tonight and **every merge
conflicted on that one file and was resolved identically**. The entry proposes a `.gitattributes`
merge driver that recomputes — and records the trap that cost two retries here: the tracked docs
have no trailing newline, so `check-doc-index-size` counts one more than `wc -l`, and only the
count the check *reports* is the number the gate accepts. It also says plainly that the conflict is
correct by design (LA-33 split these per-document; two PRs raising the same doc genuinely disagree)
— the waste is the hand-resolution, not the conflict.

**Not exercised:** no device run and none owed — this is a server-side merge rule plus a route body
shape, both of which run for real in the tests. No UI changed. The offline half is untouched;
`upsertSupplementLog` already passed a complete triple and still does.

<a id="2026-09-10-lane-a-la101-zero-failure-red-run"></a>

# LA-101 — the red run with no failing tests: measured, not fixed

**Branch:** `lane-a/la101-worker-teardown-console-race` · **Lane A** · docs only, no code changed.

## What it was

A full `pnpm test` exits **1** while reporting `0 failed`. The entire failure is one line —
`EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending` — a
worker torn down with a `console.*` forward still in flight. Seen twice on 2026-09-10, both during
interactive work, both clean on an immediate re-run of identical code.

## The outcome, stated plainly

**Not fixed. Not reproducible.** 24 controlled full runs produced zero occurrences: 8 with
file-based console tracing, 8 plain, 4 under a concurrent `pnpm dev` server driving 200 API requests
against the same Postgres. Contention was the leading theory and the experiment killed it.

So no fix shipped, deliberately. Without a reproduction there is nothing to verify against, and the
one candidate change — `disableConsoleIntercept: true`, which would make `onUserConsoleLog`
structurally impossible — costs per-file log attribution for everyone. Buying that with a fault
nobody can trigger is a bad trade, and an unverifiable fix in the tree is worse than an accurate
note.

The deliverable is the recognition rule, in
[`local-dev-database.md`](../local-dev-database.md), beside the two sibling causes of the same
zero-failing-test shape already documented there (the `migration-test-lock` hook and Q-249's
Playwright pickup). Three distinct causes now wear those clothes; a session that meets a red run with
no failing tests should check all three before believing it.

## Two things I got wrong, both worth carrying

**The entry's own first version named a culprit it had not tested.** It said to *"suspect the
interaction"* with `check-comment-blindness`, reasoning from that check's heavy console output.
Three paired runs: clean. A guess written in the same breath as a finding reads afterwards like a
lead, and it was sitting in the queue pointing the next session at a dead end. Retracting it was
worth more than the entry was.

**The run log cannot settle this, and I nearly treated it as though it could.** I grepped the failing
log for `[pg pool] idle client error` — the one console writer that fires asynchronously outside any
test's control — found nothing, and started to read that as ruling it out. It does not: **the pending
`onUserConsoleLog` is the log that never got delivered**, so the message you want is the one the
failure destroys. Its absence is guaranteed under every hypothesis. That is why the tracing appends
through `fs.appendFileSync` rather than console. The harness worked; it simply had nothing to catch.

## What the investigation did find, by breaking things

Killing a suite mid-run leaves two kinds of residue, and I hit both by `pkill`-ing my own batch:

1. **Fixture rows.** DB tests clean up in `afterEach`, which a killed run never reaches, so the next
   run failed on `A program named "LB-66 Program" already exists` — an error that reads like a bug in
   the program-name guard. It self-heals, so it fails once and looks like a flake.
2. **Real source files, permanently.** `check-comment-blindness` injects fixtures into actual
   components and restores them in a `finally` the kill skips. The next run then reads the *polluted*
   file as its baseline and restores to that. A `// <svg><polyline .../>` comment sat in
   `components/workout/set-card.tsx` across eight clean full runs and would never have cleaned
   itself. It never reached `main`, and the stop-hook prompt to commit it was declined for exactly
   this reason.

Both are now documented next to the existing `pkill` warning, which covered exit 143 and not these.

## Not exercised

No product code changed, so nothing to exercise and no device check owed.

<a id="2026-09-10-lane-a-la96-two-marker-deload-gate"></a>

# LA-96 — the two-marker deload gate, applied everywhere and de-duplicated

**Branch:** `lane-a/la96-two-marker-deload-gate` · **Lane A** · no migration, no native change.

## What the entry claimed, and what held

All of it. Six queries read `estimated_1rm` as a real max; two carried both markers
(`estimated_1rm > 0` **and** `exercise_deloaded = false`) and four carried only the first. Verified
site by site against `main` before touching anything.

The reason the second marker exists is in `getLastRealOneRmBatch`'s own comment: `> 0` alone trusts
the write-time invariant that a deload always stores 0, and production has broken that invariant.

## What shipped

`getYearReviewTopExercises`, `listRecent1rm` and `getExercise1rmHistory` now carry both markers. The
year-review filters sit on the two aggregates rather than the `WHERE` clause, because `setCount` must
still count a deload's sets — the exercise was trained, it just did not produce an estimate.

The fourth site was not a fourth site. `app/api/strength-trend` held a **byte-identical copy** of
`getExercise1rmHistory`'s 90-day query, which is how it came to miss a gate the repository was also
missing — one bug living in two places, exactly what **One Formula, One Place** predicts. The route
now delegates, so there are three sites and one place left to forget.

## The change moves nothing today, which was the point of measuring

Zero of the owner's 444 exercise logs hold `estimated_1rm > 0 AND exercise_deloaded = true`,
soft-deleted rows included. All three affected routes (`/api/strength-trend`, `/api/weights-summary`,
`/api/year-review`) return **byte-identical JSON** before and after, checked against a live `pnpm dev`
by stashing the change and re-calling each one. This is a read-time backstop for the next write-time
regression, not a fix for a visible number.

## Q-228 struck

The Known Issue that started this family is now fully resolved and moved to
`known-issues-resolved.md`. Migration `186_q228_deloaded_log_1rm_straggler.sql` zeroed the straggler —
measured today, the row still exists, un-deleted, at `estimated_1rm = 0`. Its text had gone stale in a
way worth noting: it said `getLastRealOneRmBatch` *"never filters on `exercise_deloaded`"* long after
that filter landed, and called it *"the one query in this family missing"* the filter when four others
were. An entry describing a gap outlived the gap and understated it at the same time.

## What the mutation pass caught that the tests did not

Two survivors, both the same shape — a fixture that cannot witness the rule it is aimed at:

- The deload sat in the **middle** of the series, and `getYearReviewTopExercises` picks the extremes
  by `logged_at`. Deleting its gate changed nothing. Moved the deload to the newest row, which is
  also the shape the production incident took.
- That kills the `last1rm` filter's mutant but not `first1rm`'s, since one exercise can only witness
  one end. Added a second exercise that **opens** its year on a deload.

Six mutants killed, one deliberately equivalent control (`= false` → `IS NOT TRUE`; the column is
`NOT NULL`) survived as it should. A seventh "survivor" was a bad mutant, not a blind test: `perl -0`
slurps the file as one record, so a per-line counter never reaches 2 and the edit silently no-ops.

Also worth carrying: a backtick inside a `sql` template literal **terminates the template**. Two of
these comments were written with `` `> 0` `` in them and the queries failed at runtime with
`TypeError: 0 is not a function`. Neither lint nor `tsc` says anything — it is valid JavaScript.

## Filed on the way past: LA-101

Two full runs this session exited **1** while reporting 0 failing tests — an
`EnvironmentTeardownError` from a worker closed with a console-log RPC in flight, both times clean on
an immediate re-run of identical code. CLAUDE.md already names that signature for the
`migration-test-lock` case; this is a second cause wearing the same clothes, and a red gate that is
not a red gate is the expensive kind. Filed rather than shrugged off.

## Not exercised

No device path (server reads only) and no APK. The dev-server pass covered all three routes
authenticated, plus the 401. Production data was read, not written.

<a id="2026-09-10-lb62-zero-arg-mock-check"></a>

# 2026-09-10 — a check for the mock shape that turned `main` red three times (LB-62)

**PR:** `lane-a/lb62-zero-arg-mock-check` · **Lane A** · a `scripts/` check + one CI step.

## The shape

`const f = vi.fn(async () => undefined)` declares no parameters, so TypeScript types
`f.mock.calls[0]` as the empty tuple `[]`. A spec that then reads `[0]` off it gets **TS2493**, and
an `as {…}` on the result adds **TS2352**. The mock still works at runtime — vitest records
arguments regardless of the declared signature — **so the spec passes and only the type checker
objects.** Three instances on 2026-09-07, each of which turned `main` red.

## The entry named a cheaper alternative. I priced it, and it was already spent.

LB-62 said to consider making `check-test-typecheck` runnable without a build, or adding it to
`pnpm ci:local`, *"which may make the bespoke check unnecessary."* That was the right question to ask
first. The answer:

- `pnpm ci:local` **already runs it** — `typecheck:tests` went in with **#770 on 2026-09-02**,
  **five days before all three incidents**.
- It **already runs without a build** — it needs `node_modules`, not `.next`.

So the cheap fix was in place and the class shipped anyway, because the authors were running `pnpm
lint` and `pnpm test` separately rather than `ci:local`. That prices the alternative at zero
remaining value and makes the targeted check the only lever left.

## What the check adds, stated honestly

**It finds nothing `check-test-typecheck` misses.** Both see the same 52 TS2493s. It finds them
**four minutes earlier** — in Custom Rules, which installs nothing and answers in ~25 seconds,
instead of the Build job after an install and a full `tsc` — and it prints the one-line fix instead
of a TS code.

## 39 sites baselined, and why not zero

Every hit is real: the type checker reports **52 TS2493 errors** across the tree, and each of the 39
line-hits appears in that output. No false positives. There are false *negatives* — a `vi.fn(`
whose arrow spans two lines is missed, e.g. `scale-ble-day-keying.test.ts`, which `tsc` catches and
this does not.

Clearing the 39 is not this check's job. Each fix means choosing the parameter types the assertion
reads, which is a judgement per site, and getting one wrong makes a spec assert against a shape the
code never produces. Shrink-only, in the repo's existing convention, and it shrinks when someone
touches the file.

## Verified in both directions

Five probes, and the third is the one that mattered:

| probe | result |
|---|---|
| A new file with a zero-arg mock indexed | **fails** ✓ |
| A zero-arg mock never indexed | allowed ✓ (no false positive) |
| **The prescribed fix — a typed mock, indexed** | **allowed** ✓ |
| A baselined file improved without lowering its row | **fails** ✓ (shrink-only holds) |
| Control: whitespace in the baseline | survives ✓ |

**A check whose suggested fix does not satisfy it is worse than no check** — it sends people in
circles. That is what the third probe exists to prove, and it is the one I would have skipped if I
had been going quickly.

`pnpm check:rules` now reads **72 of 72**, up from 71, picked up from the YAML by the runner rather
than any hardcoded count.

**Not exercised:** the CI job itself. The step is one line in `ci.yml` matching the twelve around it,
and `check:rules` parses that YAML and ran it, but the first real GitHub run is this PR's.

<a id="2026-09-10-lb93-poll-baseline-hop-test"></a>

## 2026-09-10 — LB-93: the flaky baseline-hop test, and the regression my own first fix introduced

Lane A. One test file, no product code. LB-93 leaves the queue.

**The entry described the problem correctly and the fix wrongly, and the file said so.** It reports a
fixed 300 ms sleep appearing *"twice"* in one test, with the fix being *"poll `stateOf(sessionId)`
until `baselineComplete` flips"*. The sleep appears **eight times across seven tests**, and that
prescription applies to **three** of them. The other five assert that something did *not* happen,
and there is nothing to poll for in an absence.

**What the call site settles that the entry does not.** `completeWorkoutFromPayload` fires
`recordBaselineAnchorsFrom` and drops the promise on purpose — a completion must never fail on a
periodization write — behind `phase === 'baseline' && !baselineComplete`. So the eight sites are
three kinds, not one:

| kind | n | fix |
|---|---|---|
| positive — the flag flips, the anchor appears | 3 | poll for it |
| negative, but the write *does* run and leaves a partial map | 3 | poll for the partial map's size, **then** assert the flag stayed false |
| negative, and the guard means **no async work starts at all** | 2 | see below — this is where I got it wrong |

**My first version deleted those last two sleeps outright, reasoning from the guard, and the
mutation pass caught it as a regression.** Replacing the call-site guard with `if (true)` was
**caught by the old file** on *"leaves a session that is NOT in baseline alone"* and **survived the
new one**. Deleting the wait did not remove a bet; it removed the test's teeth. Reasoning about the
guard was right about the mechanism and wrong about the consequence.

**The correction, and the general point.** A negative assertion cannot have its bet removed — only
its *direction* chosen. `expectNoWrite` polls for the write to appear and passes when the window
expires, so contention on a loaded runner yields a false **pass** rather than a false **failure**.
That direction is the entire complaint in LB-93: the old sleep failed on branches whose diffs could
not have caused it, and cost five runs to rule out.

**Mutation record, both files, so the comparison is the evidence:**

| mutant | old file | new file |
|---|---|---|
| M-A — the fire-and-forget write takes 800 ms | **5 of 8 FAIL** | **8 pass** |
| M-B — the call-site guard replaced by `if (true)` | test 6 caught (325 ms) | test 6 caught (**33 ms**) |
| M-B against my *deleted-sleep* first draft | — | **survived** — the regression above |

M-A is the direct proof the bet is gone for the six sites that had one: 800 ms is longer than the
300 ms the file used to wager. It also independently confirms the guard reading — under a slow
write, the two no-async-work tests pass in the *old* file too, which is why only five of eight go
red rather than seven.

**Runtime, measured 3 runs each rather than asserted:** 6.25 / 6.32 / 6.62 s → 4.83 / 5.24 / 5.79 s.
About 1.1 s faster, which is 2.4 s of sleeps removed against 1.0 s of windows added.

**Not exercised:** nothing outside this test file changed, so there is no product behaviour to
verify and no device check owed. The flake itself only reproduces under full-suite contention (LB-93
measured 1 of 2 on the same tree), so a green run of this file alone was never going to be the
evidence — the mutants are, because they make the failure deterministic instead of waiting for it.

<a id="2026-09-10-q10-close-dead-residue"></a>

# 2026-09-10 — closing Q-10, whose remaining suggestion would reintroduce the bug it exists to fix

**PR:** `lane-a/q10-close-dead-residue` · **Lane A** · docs only, nothing implemented.

Q-10's live symptom shipped on 2026-08-02: `groupSleepPeriods` drops zero-duration windows before
classifying, so a degenerate row can no longer become the most recent night and null out
`previousNight`. What remained was described as a nice-to-have — *"persisting Oura's session `type` /
the ring's bedtime-period tag."*

Both halves are dead, and the second is the interesting one.

## Half one has no source

The Oura Cloud integration was removed on 2026-08-13 and must never be re-added. Nothing supplies a
session `type` any more, so that half cannot be built at all.

## Half two would persist the defect

`bedtime_period` (0x76) is not the nightly window the entry assumed. Measured on-device on
**2026-07-09** and recorded in `lib/oura-ble/rollup/run.ts`: on this Ring 5 the captured events are
**~0.5 h sub-period fragments** (e.g. 01:23–01:53), not the full night. The comment there says
treating them as sleep windows *"produced tiny or duplicate sleep rows and blew displayed end times
into the afternoon"* — which is *degenerate sleep rows*, the title of this entry. The rollup ignores
any bedtime window under three hours for exactly that reason.

**So the residue is not low-value work; it is a proposal to persist the defect.** Q-10 is closed and
moved to the resolved archive rather than left in the queue as a nice-to-have someone eventually
picks up on a quiet evening.

## What made it findable

The measurement that kills it (2026-07-09) **predates** the note that left the residue (2026-08-02).
The information was in the repository, in a comment, a month before the entry was written — nobody
connected the tag named in the backlog to the tag measured in the decoder. Reading the entry gives no
hint; only opening the decoder does.

That is the sixth entry today whose factual claims did not survive contact with the code, and it fits
the pattern exactly: **every one was found by working the entry, not by reading it.** A documentation
sweep would have read this residue as a reasonable small feature.

**Not exercised:** no code changed. The `bedtime_period` finding is quoted from the rollup's own
source comment and its `MIN_BEDTIME_DS` guard, not re-measured — re-measuring needs the ring.

<a id="2026-09-10-q28-applydelta-domain-tripwire"></a>

## 2026-09-10 — Q-28's tripwire was prose, so eleven domains were added without anyone re-running the number

Lane A. Q-28 (`applyDelta` crosses the Capacitor bridge once per row) stays deprioritised — the
batching refactor is **not** built here, and the re-measurement says it still should not be. What
shipped is the guard the entry asked for and nobody wrote.

**Re-verified against `main` and production before touching anything, and four numbers were stale:**

| claim | entry said | measured 2026-09-10 |
|---|---|---|
| delta domains | 20 | **31** |
| full-restore rows | ≈1,800 | **3,544** (+92% in five weeks) |
| `oura_heartrate` rows | 37,950 | **111,246** |
| `runSQL` / `applyDeltaBody` | `sqlite-service.ts:134` / `sqlite-backend.ts:1186` | `:198` / `:1252` |

**The verdict survives all four.** 3,544 is still the low end of the entry's own criterion, not the
five-figure case, and it is still a one-time path on the code with the worst data-loss history in
the repo. What changed is the *tripwire*: the entry says adding a high-cardinality timeseries makes
the refactor urgent in the same PR, and at 111,246 rows the HR series is now a **32×** multiplier on
the restore rather than the 22× the old figures implied.

**That tripwire was a sentence in a backlog entry, and prose does not block.** Nothing made a PR
adding a domain notice it — which is exactly what happened eleven times. `check-apply-delta-domains.js`
(Custom Rules, step 73 of 73) now freezes the domain list: adding one fails with the question to
answer first — how many rows, at what cardinality — rather than passing silently. The extraction
lives in `scripts/lib/apply-delta-domains.js` so the check and its test cannot drift, per the same
lesson `lib/lane.js` carries.

**Mutation pass, 4 mutants, 2 controls.** M1 (a plain `delta.ouraHeartrate` inside the method) —
CAUGHT. M2 (method renamed) — CAUGHT, with a message saying to re-point the check rather than delete
it. M3 control (a baselined domain referenced twice) — SURVIVES, correctly. M4 control (a new
`delta.*` in a *different* method) — SURVIVES, which is the brace-walk scoping the unit test pins.

**One mutant had to be rewritten, and it is recorded rather than quietly fixed.** M1's first version
wrote `(delta as any).ouraHeartrate` to satisfy the typechecker, and the check missed it — read as a
miss until the mutant was corrected. The scan is textual, so a cast genuinely does hide an access.
That is now stated as an honest limit in the check's header beside the "a committed baseline can be
regenerated" one. A real domain addition types the delta and reads `delta.x` directly, so the gap is
narrow, but it is a gap and it should not be discovered by the next person.

**Not exercised:** the bridge-crossing cost itself is still device-only — native SQLite does not run
in the sandbox, and nothing here changes runtime behaviour in any case (a CI check, a JSON baseline,
a test, and backlog prose). Row counts are production reads through `/api/admin/db-query`, which is
**row-scoped to the owner** — the restore figure is one user's restore, which is the right scope for
this question, but it is not a claim about anyone else's.

<a id="2026-09-10-q30-db-size-remeasured"></a>

# 2026-09-10 — the database shrank 46% while an entry projected it would nearly double (Q-30)

**PR:** `lane-a/q30-db-size-remeasure` · **Lane A** · docs only, nothing implemented.

## I ran the session-start checks late, and one of them mattered

CLAUDE.md's session-start ritual requires reading `error_events` and the database size. **I did
neither at the start of this session** — fourteen PRs in before running them. Recording that plainly
because the omission is the kind that costs nothing until it doesn't, and one of the two reads turned
out to change a queue entry's argument.

## `error_events`: nothing new

Nine signatures over seven days, all known:

- **`bf110 resume dom-intact …`** (client, 8 of 9) — deliberate instrumentation. BF-110's own entry
  says *"Check `error_events` for `bf110 resume` afterwards"*. Not faults.
- **`/api/oura-ble/samples#aggregate`** (server, 1 hit, 2026-09-03 08:04:43Z) — already recorded and
  diagnosed in full, down to the same timestamp and the same `Connection terminated due to connection
  timeout` cause chain inside the rollup worker.

Nothing owed a Known-Issues row, which is the outcome the ritual is supposed to be able to produce
and rarely gets stated.

## Database size: the finding

| when | `pg_database_size` | `oura_raw_samples` |
|---|---|---|
| 2026-07-21, post-REINDEX | 205 MB | — |
| 2026-08-08 | 421 MB | 306 MB / 881,603 rows |
| **2026-09-10** | **227 MB** | **75 MB / 195,769 rows** |

Q-30's 2026-08-08 note projected the database *"returns to the ~924 MB alarm level in roughly six
weeks whether or not [the console actions] run"*, and stated that **"only D4 or a retention policy
changes the direction."**

Four and a half weeks on it is **227 MB — down 46%, not up**, and the table blamed for 73% of the
total has lost **78% of its rows**. The packing work plus the retention window did what D4 was
projected to be needed for.

**What that does and does not settle.** It removes the *urgency*, not the decision. The owner's
stated reason for D4 was the multi-user ratio — ~36 GB/year for ten users server-primary against
~160 MB/year device-primary — and a shrinking single-user database says nothing about a ratio. The
entry now says so explicitly, because "the database is fine" is exactly the wrong lesson to draw and
the easy one.

**One number replaces the one that expired:** `oura_raw_samples` now carries **44 MB of index against
30 MB of heap**. CLAUDE.md's advice to read `total` *and* `idx` exists because the 2026-08-17 outage
was index and dead-tuple bloat with the payload unchanged, and an index larger than its table is
where that starts.

## Q-30 also gets a `Gate: owner`

Everything still open in it is D4 (a destructive server-raw drop) or a retention policy — data
deletion either way, and confirm-first by CLAUDE.md's rule. It was printing as ordinary READY work
while its own body said the remaining half is confirm-first. **Fifth field/prose mismatch this
session**, and the second I have fixed rather than fallen into.

**Not exercised:** no code changed. Both figures are from `/api/admin/db-query`;
`pg_stat_user_tables` is not row-scoped, so the sizes are the whole database, while the
`error_events` counts are the owner's rows only.

<a id="2026-09-10-q52-remeasure-program-rebuild"></a>

## 2026-09-10 — Q-52 re-measured a third time: the precondition cleared, then the program was rebuilt (docs + one comment)

Lane A. Docs-only apart from a comment in `lib/data/postgres/adapter.ts`. Nothing implemented.
Full evidence: [`docs/reviews/2026-09-10-q52-phase-hold-remeasure.md`](../reviews/2026-09-10-q52-phase-hold-remeasure.md).

Q-52 (per-exercise phase hold) carried an explicit outstanding precondition from 2026-08-03:
*"No session has transitioned since the auto-apply fix shipped… Re-run this once at least two
sessions have cycled."* This session ran it.

**The precondition is met.** Eight `session_periodization` rows carry a `phase_started_at` after
2026-08-03 (2026-08-16, 08-27, 09-01, 09-03, 09-06 ×2, 09-07, 09-09), each marking at least one
transition. Blocks now cycle.

**And meeting it made the entry's measurement unrunnable.** The active program is **Bankai, created
2026-09-06** — four days old. All eight transitions belong to its predecessor (**Shikai**,
2026-07-01), whose `program_sessions` are inactive, and phase state is keyed by
`program_session_id`, so the rebuild reset it: Push and Pull sit in `baseline` with
`baseline_complete: false`, Legs entered `accumulation` on 09-09, and Upper and Lower have no
periodization row at all. Every last-vs-previous 1RM pair therefore straddles the rebuild (`prev`
2026-08-17…08-30 on Shikai, `cur` 2026-09-06…09-09 on Bankai). The raw table reads 6 up · 10 down
with five declining compounds at −5% to −29%, but three of the five are mid-`baseline`
re-anchoring and the other two just left a realisation block. **The recipe cannot separate a
programmed drawdown from a stall once blocks actually cycle** — which is the point worth recording:
the precondition and the recipe were mutually exclusive all along.

The 2026-08-03 load-bearing claim ("the feature would apply to a single exercise") is now
**unsupported rather than refuted** — it was computed against a program that no longer exists. The
design is untouched. Earliest answerable date is mid-October, after Bankai's own sessions complete
baseline and cycle twice. The entry records that and says explicitly not to re-run the query before
then; it is deliberately **not** gated, because `Gate:` resolves to a person or the S25 and what is
owed here is elapsed training time.

**Upper and Lower having no periodization row is not a defect** — `ensureSessionPeriodization`
inserts lazily and neither has been prescribed since 2026-09-06. Checked rather than filed.

**The zero-1RM scare, and the one entry it produced.** 41 `exercise_logs` carry
`estimated_1rm = 0`; **31** are `exercise_deloaded = true` and correct per the documented invariant.
The other **10** are two whole Pull sessions (2026-08-09, 2026-08-16) storing `estimated_1rm = 0`
with `exercise_deloaded = false` on real working sets — Sumo Deadlift 82.5 kg × 6,
`use_for_1rm: true`, `planned_pct: 80`. That is exactly the shape **Q-298 already fixed**:
`log-exercise.ts` used to store `exerciseDeloaded ?? false` while passing
`exerciseDeloaded === true || (isAnyDeload && !isBaseline)` to the estimator, so a phase-level
deload zeroed the 1RM and the row denied it. All ten predate the fix, none after it has the shape,
and every 1RM reader excludes them via `estimated_1rm > 0`. Not filed.

**Checking that is what produced LA-96.** `getLastRealOneRmBatch` justifies its second predicate
with a cited production violation — a 2026-08-06 log at `estimated_1rm = 85.75` with
`exercise_deloaded = true`. **That row is gone:** 0 of 444 logs hold that shape, deleted rows
included, and 2026-08-06 now reads consistently (five non-deloaded logs with real values, five
deloaded at 0). The comment's evidence is stale; its argument is not — a backstop exists for the
*next* regression — so the filter stays and the comment now records the correction alongside the
surviving opposite-direction residue. What the check did expose is a sibling-surface gap: **of six
1RM read sites only two apply both markers**; `getYearReviewTopExercises`, `listRecent1rm`,
`getStrengthTrend` and `/api/strength-trend` guard on `> 0` alone. Filed low in the queue, because
with zero rows of the offending shape the exposure is nil. LA-96 also notes that the last two of
those four are the same 90-day query duplicated across a slice and a route — **One Formula, One
Place** — which if resolved first makes it a three-site change.

**Not exercised:** no behaviour changed — the only code edit is a SQL comment. All measurements are
production reads through `/api/admin/db-query`, which is row-scoped to the owner; nothing here is a
claim about other accounts. No device run, and none is owed.

<a id="2026-09-11-baseline-autoheal-recreated-session"></a>

# 2026-09-11 — the recreated Lower session that skipped its baseline (BF-143)

The owner rebuilt the Lower session that BF-124's unconfirmed delete removed, and reported it never
asked for an AMRAP. It didn't, and the state is worse than a missing prompt.

## What is stored

`session_periodization` for the active program's Lower, read 2026-09-11: `phase = accumulation`,
`baseline_complete = true`, `sessions_in_phase = 0` — against **zero** `workout_sessions` rows for
that session. The Health card's "Never trained" is correct; the phase beside it is not.

## One crash-recovery path, three defects

`app/api/ai-periodization/session/[sessionId]/route.ts:30-51` exists to repair a baseline whose
completion endpoint was never reached — "app crash / navigation away", in its own words. A session
recreated yesterday is neither, and it qualifies only because its exercise *names* match rows logged
earlier in the same program. The block is scoped to `program.id` precisely so a name logged under a
*different* program cannot skip a fresh AMRAP week — the right harm, guarded across programs and
unguarded within one.

Three things go wrong in those twenty lines, and fixing the trigger alone leaves two live:

- `:41` uses `.some`, so one matching exercise name completes the baseline for all of them.
- `:44-49` writes an entry only when a personal record exists, then marks the session complete
  regardless. Lower has four exercises and three baselines; `Dumbbell Calf Raise` has no PR, got no
  baseline, and now nothing will ever ask for one.
- `:46` writes `{ kg: pr }` with no bodyweight branch. Lower's stored baseline holds
  `Hanging Leg Raise: {"kg": 128}` — an exercise that is `equipment: ["bodyweight"]` and whose
  maximum `weight_kg` across 26 logged sets is **0**. The 128 is the `BW_REF = 100` index BF-127
  identified.

## Why this enlarges BF-127

BF-127 reads as a display bug — a suggested weight printed on a banner. This is the same index
entering `session_periodization` as a stored baseline, where prescription percentages multiply it.
A wrong banner number is read once; a wrong baseline is the denominator for a cycle. BF-127 should
not be closed as display-only.

## Two smaller things worth keeping

The adoption happened silently on a **GET**, so opening the card committed the state — which is why
it is already durable in production rather than something not starting the workout would have
avoided. And the "Use prior data" affordance the owner has used elsewhere never appeared here: the
same adoption happened without asking.

## Fixed the same session, at the owner's request

He was training and asked for it directly, so this stopped being intake. Three changes:

The auto-heal now requires a log **newer than `phaseStartedAt`** rather than a name that has ever
been logged. That is the only honest test of the interruption it exists to repair, and a recreated
session's logs predate its own phase clock.

**A correction to that, found while closing the session out.** The lookup is name-keyed, and the
reason written into the code for that was wrong: it claimed `program_session_id` is NULL on every
row. That measured the dead column of the pair `schema.ts` warns about. The live link is the column
named `session_id`, it is populated on 62 of 108 rows, and on 2026-09-11 each of the four trained
sessions had one while the recreated Lower had none — the exact question, available directly. The
date comparison is what actually carries the guard and the behaviour is correct, but the reasoning
is not, and a reason left in a comment is what the next reader builds on. Corrected in the code and
filed as BF-144, which moves the test onto the id link.

It also completes only on full coverage, which is the invariant `recordBaselineAnchors` already
holds for the measured path and states in its own docstring.

And `revertAutoAdoptedBaseline` undoes a baseline already stored from borrowed PRs, so Lower repairs
itself when its card is next opened. That matters because there was no other route: the production
query endpoint is read-only and no reset control exists in the app.

The narrowing is the safety property, not the revert. Four other sessions on the owner's account
carry `amrap` (Legs, Upper) or `existing` (Push, Pull) anchors, and a wider revert would throw away
real cycles. `source: 'personal_record'` is written in exactly one place, which is what makes the
discriminator sound — five DB-backed cases pin it, and removing the guard fails three of them.

## What is NOT fixed

The bodyweight index. The adoption path still writes `{ kg: pr }` with no bodyweight branch, so a
genuinely interrupted session containing a bodyweight movement would still store an index under a
key named `kg`. The revert removes the bad anchors and the new gates stop fresh ones, but the
resolver work stays open under BF-127 — which this should not be read as closing.

## Not exercised

The authenticated body of the route was never run by a browser. `pnpm dev` confirmed the module
loads and returns 401 without a session cookie, and no device or real session was available in the
sandbox. The logic is covered by 31 unit cases and 5 DB cases, both mutation-checked, but the owner
opening Lower is its first real execution.

<a id="2026-09-11-chore-or-108-bf110-viewport-lead"></a>

# 2026-09-11 — BF-110's own telemetry separates the blank resumes perfectly

**Branch:** `chore/or-108-bf110-viewport-lead` · one backlog entry amended. No product code.

## What the breadcrumbs say

BF-110 already ships a `bf110 resume dom-intact` breadcrumb carrying the viewport and the DOM child
count. Nobody had read them together. Sixteen samples in `error_events`, **zero overlap**:

| viewport height | DOM children | samples |
|---|---|---|
| **667** | **1–2** (blank) | 8 |
| **826** | **7–8** (rendered) | 8 |

The S25's real CSS viewport is 826. **384×667 is the classic fallback viewport** a WebView reports
before it has been told the real size.

## Why that changes the hypothesis

BF-110 has been diagnosed as a Samsung WebView **compositor** failure — the renderer dying, painting
nothing. The separation says something different and cheaper: the WebView resumed at a fallback
viewport and **the app rendered almost nothing into it**. One is a native-layer problem, the other is
a question about when the app decides to render.

## The competing reading, recorded beside it

667 may simply be measured **before** the WebView has resized — a timing artefact rather than a stuck
state. The data cannot separate the two.

**What settles it, and it is one line of telemetry:** log the viewport a second time ~500 ms into the
same resume. Still 667 → genuinely stuck, and the fix is native. Reads 826 → measured too early, and
the fix is in the render gate. Both readings are in the entry so nobody spends a day in the wrong
layer.

## Not done

The second breadcrumb is not added here — BF-110 is Lane B's and `Gate: device`; this entry records
what the existing data proves and what would settle it. No fix is proposed, because which fix is
right depends on the answer.

**Surfaces not exercised:** none apply — one backlog entry; no runtime code, no device path, no
schema. `pnpm check:rules` **Ran 73 of 73**.

<a id="2026-09-11-chore-q-44-sensor-discriminator"></a>

# 2026-09-11 — 73% of `oura_heartrate` is a Polar chest strap (Q-44's second requirement)

**Branch:** `chore/q-44-sensor-discriminator` · one backlog entry amended. No product code.

## The question behind it

The owner asked to replace `oura` with `sensor` in the table names **and** *"make sure we know which
sensor somewhere, so we can use the same tables for other recording devices"*. The first half has
been queued as Q-44 since 2026-08-02, with a written Phase-3 plan since 2026-08-04. **The second half
was not in either.**

## What production says

`oura_heartrate.source`, measured:

| `source` | rows | period | what it is |
|---|---|---|---|
| `chest_strap` | **84,246** | 2026-07-17 → now | Polar H10 |
| `ble` | 19,376 | 2026-07-06 → now | Oura ring, direct BLE |
| `workout` / `awake` / `rest` / `live` | 12,494 | 06-22 → **07-06 only** | Oura Cloud, dead era |

**The table named after one vendor is 73% another vendor's.**

An earlier draft of this called the column *overloaded* — device names mixed with context names. That
was wrong, and the backlog already said so 5,000 lines away: the four context-looking values are Oura
**Cloud** series types from the pre-BLE era, and that era's last row is 2026-07-06. The discriminator
works for everything current. Recorded because the wrong reading is the intuitive one.

## The actual gap: coverage

**5 of 22 vendor tables carry a `source` at all** — `oura_heartrate`, `rr_intervals`, `oura_workouts`,
`oura_tags`, `oura_daily_derived`. The other 17 do not, and **`oura_bucket` is among them** — the
intraday rollup a second device would most need to share.

So renaming `oura_bucket` → `sensor_bucket` on its own buys a portable-looking name and no
portability, which is worse than the honest vendor name: it invites the next writer to assume a
guarantee the schema cannot deliver.

Q-44 now asks for a **column audit beside the rename**, per table: does a second source ever write
here (→ needs `source`), or is it structurally single-device (→ keep the vendor name, as
`oura_raw_samples` already does, because it holds reverse-engineered frames of one ring's firmware).

## Not done

No rename, no column added. Q-44 is Lane A and carries real regression risk — its own plan names the
trap, that `sync-engine.ts` dispatches on domain *strings* and an already-installed APK keeps sending
the old ones until reinstall. This records the requirement the plan was missing.

**Surfaces not exercised:** none apply — one backlog entry; no runtime code, no device path, no
schema. `pnpm check:rules` **Ran 73 of 73**.

<a id="2026-09-11-fix-nutrition-scroll-and-day-padding"></a>

# 2026-09-11 — Nutrition keeps its scroll position, and `/health/day` clears the gesture bar (RV-36, RV-37)

**PR:** `fix/rv-36-nutrition-scroll-restoration` · **Lane B** · `app/nutrition/nutrition-content.tsx`,
`app/health/day/day-detail-content.tsx`, `components/pull-to-sync.tsx`, `e2e/scroll-restoration.spec.ts`.

Two `[app-shell]` items shipped together because **one device pass covers both** — CI is free, the
device is not.

## RV-36 — the tab that inherited nothing

BF-100 put `useScrollRestoration` in `pull-to-sync.tsx` and both its entry and the call-site comment
said that meant *"every screen using the shell inherits it"*. It means every screen using
**`PullToSync`**, and three do: `health-content`, `more-content`, `session-select-content`. The
Nutrition tab owns its own scroller and inherited nothing.

Measured with BF-100's own recipe (wheel scroll → in-app `router.push` → `goBack`): `/more` →
*Profile details* → back restores **840**; `/nutrition` → `/coach` → back saved **no** `ta_scroll:`
key and returned **0**.

The fix is one hook call on the tab's existing scroller — not a `PullToSync` wrap, which would also
hand Nutrition a pull-to-refresh gesture nobody asked for.

**The wrong phrasing is now gone from the call site**, not only from the backlog. Review corrected the
entry on 2026-09-03; `pull-to-sync.tsx:46` still carried it, and that comment is what a reader hits
first. It now says the thing worth knowing: *a screen that scrolls its own container gets no
restoration from being inside the shell — check the call, not the layout.*

**The gap really is one path.** Every other routable screen that scrolls at this viewport
(`/health/sleep`, `/health/heart-rate`, `/cardio`, `/config`, `/program`) contains no `router.push`
or `<Link>` to a deeper route — they are leaves, and re-entering one is a fresh arrival that correctly
starts at the top. That was counted by RV-36, and re-reading it held.

## RV-37 — a scroller with no bottom padding at all

`day-detail-content.tsx`'s container was `flex-1 space-y-4 overflow-y-auto scrollbar-hide px-4 pt-4`
— no `pb-*` of any kind. It is a sub-route, so nothing is anchored below it and the last card ends
flush with the viewport, which on the S25's gesture navigation is the gesture bar. It now carries
`pb-nav-safe`, matching the 68 px `/more` measures.

**This was never observed and still has not been.** The seeded fixture renders *"Nothing logged on
this day"*, so the container never becomes scrollable in the harness. The absence of padding is read
from source, and CLAUDE.md treats even a bare `pb-safe` as too little clearance here — but whether
the symptom is visible needs a real day with enough logged.

The **fifth-CI-rule question stays open** and is kept on the entry: all four safe-area rules fire on a
*wrong* utility, none on an *absent* one. A "full-height scroller with no bottom pad" check would need
an allow-list for the sheets and navless full-screens that legitimately have none, and that list is
worth drawing only once the device says the class is worth a rule.

## Verification

`e2e/scroll-restoration.spec.ts` gains the `/nutrition` → `/coach` → back case. All three cases pass
— and the new one was **confirmed red with the fix stashed**, failing on its precondition with
`Received string: "{}"` (nothing saved at all) rather than the ambiguous `expected 840, received 0`
that file's header records three earlier versions dying on. Naming which precondition broke is the
difference between a guard and a coin flip.

**Not exercised:** the S25. RV-36's check is the **system back gesture**, which is the one gesture the
harness cannot send — `page.goBack()` is not it. RV-37's is a day with enough logged to scroll. Both
are `Verify: device` on their entries and in one row on `projectOverview.md`.

## Two E2E reds cleared on the way past, neither of them this branch's

The advisory job came back with two hard failures. Both were already on `main`, and both are fixed
here rather than left, because a red E2E that has to be opened and read is the cost LB-54 and LB-56
are both about.

**`reta-weight-response.spec.ts:142` is LB-99's missed sibling surface, and it is mine.** That PR
split the placeholder chip in two — three weigh-ins can fit a rate, so a withheld verdict reads
*"Not called yet"*, and *"Not enough weigh-ins yet"* is reserved for genuinely too little data. The
unit test pinned the new string; the e2e spec asserting the same chip on the real screen did not get
updated. Its own comment already described the new behaviour, which is the tell that only the string
was stale. The sibling verdict test's negative assertion is widened to both labels: asserting the
absence of a string that can no longer render in any state checks nothing.

**`plan-rescale.spec.ts:230` is not mine, and that was established rather than assumed** — the same
failure reproduces locally against `origin/main`'s `nutrition-content.tsx`, with this branch's hook
absent. The tap that expands the meal list was landing on the Workout tab, so the list never opened
and the assertion below it never ran.

Both causes were already written down in `e2e/`, each in the file that paid for it, and neither had
reached this one. `scrollIntoViewIfNeeded()` stops as soon as the box is technically on screen, which
for a control this far down a long page leaves it **under the fixed bottom nav**
(`plan-meal-to-saved-meal.spec.ts`); and it scrolls *every* ancestor scroll container, one of which
is the shell's **horizontal tab carousel**, so it slides the shell off Nutrition
(`plan-meal-log-decline.spec.ts`). Both land on Workout — which is exactly why fixing one reads as
sufficient until the other fires. `block: 'center', inline: 'nearest'` answers both, and all three
specs that tap this control now carry it; the two that were not red differ only in fixture height.

A fifth `LB-56` sighting is recorded on its entry: `macro-calorie-warning.spec.ts:77` went flaky with
the renderer `SIGSEGV` at the same address as the third and fourth. It recovered on retry, which is
why it is worth writing down — a recovered sighting is the one that otherwise goes uncounted, and the
rate is the whole argument of that entry.

<a id="2026-09-11-fix-ps35b-boot-and-weather"></a>

# 2026-09-11 — four boot and chip fixes, and a report claim that did not hold (PS-35b)

**PR:** `fix/ps35b-boot-and-weather` · **Lane B** · `app/manifest.ts`, `components/sync-provider.tsx`,
`lib/stores/workout-store.ts`, `lib/weather/use-weather.ts`, `components/weather-chip.tsx`.

Four independent items from the 2026-09-05 app checkpoint, split out of PS-35 by OR-106 because a
`Gate: owner` scoped in prose to the page deletions was parking all four behind a decision none of
them needs.

## ① The PWA launched into a redirect

`start_url` was `/session-select`, which is a bare `redirect("/workout")` — so every launch from the
installed icon paid a hop before showing anything. It points at `/workout` now: the same destination,
no redirect. Whether the Workout tab is the right place for a launch to *land* is PS-35's
page-consolidation question and the owner's; this only removes the hop.

## ② The boot warm bypassed the in-flight map

`warmCache` used a bare `fetch`, which `cachedFetch`'s in-flight map cannot see — so the warm and a
component mounting at the same moment issued two requests for one URL. It now goes through
`cachedFetch` / `cachedFetchToday`, which is also CLAUDE.md's standing rule with a measurement
attached. The skip-if-fresh early return is untouched, so the shared fetcher runs only when nothing
is cached — which is exactly when a revalidation is wanted, and why no `freshWithinTtl` is involved.

**A/B on identical runs: 34 → 29 requests on boot** (32 → 27 distinct URLs), stable across two runs
of the fixed build.

**It also closed a mismatch the rewrite surfaced.** The hand-rolled envelope stamped
`todayInTz(tz)` — the user's zone — while every reader unwraps with `unwrapToday`, which compares
against `todayInTz()` (the Brisbane default). Outside Brisbane the warm write was unreadable the
moment it landed. Writer and reader now share one function and cannot disagree.

## ③ The dead branch was stale prose, not a missing feature

The E1-4 comment said a workout *"whose start anchor is >4h old **or from a previous day**"* is
abandoned. `dateRolledOver` is false at the only production call site: `onRehydrateStorage` passes
`today: null` **on purpose**, because the store runs before any provider mounts and guessing Brisbane
would clear a Kiritimati user's morning (Q-477). The day's ticks roll over separately and correctly
in `WorkoutDayRollover` → `rolloverDay(today)`, from the user's real zone.

So the code is right and the comment was wrong. Corrected, and the surviving behaviour pinned by
tests: a workout started at 23:50 and resumed at 00:10 **survives**, which is the right answer for
someone training across midnight, while a >4h anchor is still dropped.

## ④ The weather chip pulsed forever, and its cache was unkeyed

Two defects in one hook. No failure state meant a failed fetch rendered as an eternal skeleton — the
Q-499 shape, where the user cannot tell "loading" from "this broke". And the cache was **one unkeyed
entry read before any coordinates were known**, so a moved device showed the old place's weather for
up to 30 minutes *and* skipped the fetch that would have corrected it.

The cache is keyed by coordinates rounded to 2 dp — the same rounding `fetchWeatherSnapshotShared`
already used, so there is one rounding rule rather than two — and read **after**
`getDeviceLocation()` resolves, which is the half that makes the key mean anything. A stale entry for
*this* place still beats an error state; `failed` is only set when there is nothing to show.

Keying costs the synchronous seed, and a skeleton flash on a repeat visit is a bug here, so a
`ta_weather_cache:last` entry remembers where the last fetch was and seeds the paint from it — in a
`useEffect`, not the `useState` initializer the old code used.

## The report's palette claim did not hold

PS-35b said *"drop the two unreachable palette keys named in the report"*, and the report explained
that `pathname-routing.ts:26` (`/workout`) precedes `:45` (`/workout-select`).

**Those two lines are in different functions.** `:26` is in `pathnameToSection`; `:45` is in
`pathnameToPaletteKey`, and nothing in the latter matches `/workout-select` before it. Evaluated:
`/workout-select` → `workoutSelect`, `/stats` → `stats`, `/workout` → `null`. Both keys are live, and
deleting them would have removed the palette from two real routes. Not dropped; the entry records the
correction.

Worth stating as a habit rather than a one-off: **a shadowing claim is about one function's branch
order, so check the two lines are in the same function before trusting it.**

## Verification

- 13 new unit cases on the weather key, the read-after-coords ordering, the seed, the failure state,
  the manifest target, and the warm's fetcher choice; 2 behavioural cases on the midnight workout.
- **Rendered**: with geolocation granted and `api.open-meteo.com` aborted, the chip shows its `—`
  state at 32 × 24 px instead of pulsing.
- Boot request counts A/B'd as above.
- `pnpm check:rules` — **Ran 73 of 73**.

**Not exercised:** the S25, and the weather **success** path. The sandbox has no outbound route to
`api.open-meteo.com`, so only the failure branch could be rendered — the keyed cache and the seed are
unit-tested, not observed end to end. The device check is on the entry.

<a id="2026-09-11-lane-a-bf140-strap-battery-report-time"></a>

# BF-140 — the strap battery chip could not go stale

**Branch:** `lane-a/bf140-strap-battery-timestamp` · **Lane A** · no migration · **needs a new APK.**

## The defect, and why the owner's instinct was half right

The owner sent a Home screenshot of the strap chip at 100% — *"I have had it for months now and used
it. I imagine we dont have the correct metric."*

**The metric is right; the timestamp attached to it is invented.** The number is a real read of the
standard Battery Service characteristic `0x2A19`, issued once per connection.
`PolarStrapService.battery` is then written once and never cleared — no reset on disconnect, none on
stop — and `status()` publishes it unconditionally. The JS stamped `at: Date.now()` every time it
read that field, so the stored time was **when JS last looked**, not when the strap last reported.

The consequence is that the staleness affordance could never fire. `DeviceBatteryChip` dims past 180
minutes and only then names an age; with `at` refreshed on every Home mount, `stale` was permanently
false. A months-old reading was pixel-identical to a live one — which is precisely what the
screenshot shows.

Every claim in the entry checked out against the source: field declared at `:70`, assigned only at
`:232`, published at `:392`.

## What shipped

`batteryAt` stamped in `onBattery` beside the percentage, published from `status()`, threaded
through the hook into `writeStrapBattery` — whose `now` parameter already existed and which every
caller had been omitting.

## The skew the entry did not mention, and which decides the design

**The two halves ship on different clocks.** JS reaches the device through a Railway deploy
immediately; Kotlin waits for an APK rebuild. So there is a real window where the new bundle runs
against an APK that sends no `batteryAt`.

`writeStrapBattery(percent, at ?? undefined)` falls through to the `Date.now()` default there, which
reproduces today's behaviour exactly — the right answer, because in that window the timestamp does
not exist to be carried. Nothing is worse in the meantime and nothing is better until the APK lands.
A non-finite time is guarded the same way: a NaN would make `ageMinutes` NaN and leave the chip
neither fresh nor stale, which is worse than the bug it replaces.

## What I could not verify, stated plainly

**The Kotlin cannot be compiled here** — no Android SDK, Gradle download proxy-blocked — **and the
behaviour cannot be exercised**, because `getPolarBle()` returns null off-device. Seven tests cover
the JS half and the native/JS contract by reading the Kotlin source; the running mechanism is
untested. A `projectOverview.md` Known-Issues row marks it NOT device-verified with the concrete
check: post-BF-140 APK, strap off three hours, chip should dim and read *"last seen Nh ago"*.

Mutation pass: the native stamp removed, the native publish removed, the non-finite guard removed,
and both halves of the hook's threading reverted — **five mutants, all killed**; an equivalent
control (`> 100` → `>= 101` on an integer percent) survived.

## Deliberately not built

The strap keeps **no battery history** — one overwritten `localStorage` key, nothing server-side —
so *"has it moved in months?"* remains unanswerable, which is the owner's question from the other
side. The ring can answer it about itself (`oura_ble_battery_poll`: 9,578 polls spanning 9%–100%).
That is a schema change and deserves its own entry rather than being batched behind a native fix
nobody can verify yet.

**Do not read this as "the 100% was wrong."** The H10 runs a CR2025 coin cell whose discharge curve
is flat for most of its life, so a long plateau at 100% is what a truthful gauge looks like. The
defect was that nothing in the app could tell the owner either way.

<a id="2026-09-11-lane-a-bf141-lbs-to-kg-constant"></a>

# BF-141 (Lane A half) — one lb↔kg constant, so the toggle cannot grow a second one

**Branch:** `lane-a/bf141-lbs-to-kg-constant` · **Lane A** · no migration, no native change.
**The entry stays open** — the dial and the toggle are Lane B's, and this hands over to them.

## Why a constant move is the engine half of a UI feature

`LBS_TO_KG = 0.45359237` was a private const in `lib/data/postgres/adapter.ts`, written for the
2026-06-15 repair tool that corrected three dumbbell exercises logged in pounds into the `weight_kg`
column — inflating 1RM, target80, volume and the all-time PR until an admin preview/apply tool undid
it. The toggle that stops that recurring needs the same number on the client. Writing a second copy
there is how two implementations of one metric begin, which is the class **One Formula, One Place**
exists for.

It now lives in `packages/shared/src/workout/units.ts` with `lbsToKg`/`kgToLbs`, and the adapter
imports it.

## Neither helper rounds, and that is the load-bearing decision

The entry flags the hazard precisely: `mround125` clamps to **[5, 250]**, so a 5 lb dumbbell —
2.268 kg — would floor to **5 kg**, silently more than doubling it. A converted value must not pass
through the kg grid at all.

A helper that rounded itself would bury that decision one call away from where it matters, so both
functions convert exactly and the call site rounds for storage. The test pins it from the failure
side: `lbsToKg(5)` must be **less than 5**.

## The guard that needed narrowing, for the third time today

My first version asserted that `0.45359237` appears in exactly one file. It failed on two
**legitimate** hits: the adapter's comment, which still names the value while importing it, and the
test's own assertion. Matching raw text catches prose.

The assertion now strips comments and looks for a *declaration* (`const|let|var … = 0.45359237`).
This is the third time today the comment-vs-code distinction has bitten a source-level guard —
LA-101's and RV-41's both failed the same way first. Worth noticing as a pattern rather than three
coincidences: a source guard's first draft matches text, and text includes the explanation of why
the guard exists.

## Verification

7 tests. Mutation pass: the constant truncated to `0.4536`, the conversion made to snap onto the
1.25 kg grid, and the adapter re-declaring its own copy — **three mutants, all killed**; an
equivalent control (`kg / LBS_TO_KG` → `kg * (1 / LBS_TO_KG)`) survived.

## Already done, checked rather than repeated

The entry says the false `projectOverview.md` LB-41 claim — *"with real unit display filed as the
feature it would actually be"*, where no such entry ever existed — is *"corrected in this same PR"*.
It was already corrected when BF-141 was filed. Nothing owed.

## Not exercised

No device path, no APK, no API route — a shared constant and its two callers.

<a id="2026-09-11-lane-a-rv40-body-id-uuid-guards"></a>

# RV-40 — the malformed-id guard had never been pointed at a body

**Branch:** `lane-a/rv40-malformed-id-body-params` · **Lane A** · no migration, no native change.

`invalidUuidResponse` exists because Q-482 measured 21 route/method pairs answering 5xx on
`not-a-uuid`. Its own comment calls it *"the guard every dynamic `[id]` route runs"* — and that is
exactly the population it got. An id arriving in a request **body** is the same hazard and was never
swept.

Two routes still 500'd on one, both with **`Content-Length: 0`**. Re-measured live before touching
anything, and all three of the entry's consequences reproduced:

1. A zero-byte 500 makes `res.json()` throw a parse exception on top of the real fault — the
   rationale RV-33 gave for the ownership half of the very same file.
2. The malformed id reached the driver as a 22P02, so the failing statement — raw SQL, table and
   column names included — was filed into `error_events` as a server fault. My probes wrote 2 rows;
   the same probes now write **0**.
3. A client input error, answered as a server fault, in the channel every session reads first.

## Three corrections to the entry

**The population figure was stale.** The entry said *"27 route files use it, 27 of 27 are dynamic
`[id]` routes, zero take the id from a body."* Measured 2026-09-11: **35 files, 5 of them not
dynamic.** RV-47 swept three body-id routes in the interim — `admin/exercises`, `admin/users`,
`workout-entry` — with the same reasoning. The class was half-closed before this entry was opened.

**The broken verb was wrong.** The entry names `POST /api/progression-styles`. POST answers a clean
`400 Invalid style` — its Zod catches the malformed id. The 500 is on **DELETE**, which hand-parses
its body.

**The two "unverified" rows are settled, and both are clean.** `POST /api/complete-workout` and
`POST /api/log-exercise` each answer 400 JSON; their schemas reject the payload before an id reaches
the driver.

## The sweep

All eight of the entry's candidates are now accounted for, and I carried on past them through every
other hand-parsed-body route — `phase-sets`, `admin/activity-types`, `admin/invites`, `friends`,
`water-log`, `oura/workouts`, `user/equipped-title`. **No further 5xx.** Two routes were broken; both
are fixed.

## The guard is conditional on purpose

`DELETE /api/progression-styles` accepts **either** an id or a name, so the check is
`if (body.id && badId)`. Guarding unconditionally would make delete-by-name answer "Invalid id" to
every request — which is precisely the BF-53 regression, where a uuid guard applied to two
integer-keyed routes broke every real call instead of none. That mutant is in the pass below.

## Verification

5 tests. Mutation pass: each guard removed separately, plus the conditional made unconditional —
**three mutants, all killed**; a whitespace-only control survived.

Live, after the fix: both routes answer `400 {"error":"Invalid id"}` on a malformed body id,
well-formed ids still return 200, delete-by-name still works, and `error_events` gains nothing.

## Not exercised

No device path and no APK — server route guards.

<a id="2026-09-11-lane-a-rv41-coach-write-bounds"></a>

# RV-41 — the Coach could write goal numbers the user's own screens refuse

**Branch:** `lane-a/rv41-coach-write-bounds` · **Lane A** · no migration, no native change.

## The defect

One column, two validators, and the looser one was the model's. The Coach's patch schema carried a
single `max(100_000)` across all seven numeric goal fields while the user's own routes enforced their
own limits — up to **50× tighter** on the macros. `PUT /api/nutrition/targets {"calories":26000}`
answered `400 expected number to be <=20000`; the same value through `/api/coach/apply` returned 200
and stored 26,000.

The patch schema's own comment named the case it did not catch: *"'set my calories to 26000' should
be refused by the schema rather than survive to a confirmation card that looks legitimate."* It
survived, and the card read **"Calories 0 kcal → 26,000 kcal"**.

`stepsGoal` diverged in *type* as well — `z.number().int()` on the user route, a plain number in the
patch schema — so `8000.5` was a clean 400 on one path and a 500 on the other.

## What shipped

`packages/shared/src/validation/goal-bounds.ts`: `GOAL_BOUNDS` plus `goalBoundSchema(field)`. All
three schemas build from it — both user routes and the patch schema — so the numbers exist once.
`int` lives in the bound rather than beside it, because the type divergence was half the defect.

**The numbers are the user routes' own, unchanged**, per the entry's instruction to fix the
divergence rather than pick new constants by hand.

## The one field this LOOSENS, and why I shipped it rather than asked

`stepsGoal` is the exception the entry's own table flagged: its Coach bound (100,000) was *tighter*
than the form's (200,000). Importing the form's bound therefore raises what the Coach may write.

Shipped that way deliberately. The entry's rule is one source of truth and that source is the user
routes; the 200,000 ceiling is what the owner's own screen has always allowed, so this is not new
exposure — a person could already type it. The alternative, keeping 100,000 for the Coach alone, is
exactly the "restating a bound" shape that caused the drift. **It is one line to reverse if the
owner wants the Coach held tighter**, and the entry's closing question — *"whether any Coach bound
should legitimately differ from the form's"* — is still open and is theirs.

Every other field tightens, between 3.3× and 50×.

## Two things worth carrying

**The obvious regression guard was wrong, and its being wrong is the finding.** "No bound exceeds
100,000" looks like the right assertion and fails immediately on `stepsGoal`. A value assertion here
would have to carve out that exception and would then be pinning the numbers rather than the thing
that actually broke — two schemas each matching its own copy. The guard is a source check instead:
`patch.ts` must declare no numeric bound of its own.

**`check-numeric-bounds.js` matches per line**, so `const base = z.number(); return base.max(…)`
reads as unbounded to it. The helper carries `.min`/`.max` in both branches rather than chaining onto
a shared base — duplication that is load-bearing, noted in the code. The same line-scoping bit the
test: `100_000` appearing in a *comment* failed the source guard until it stripped comment lines.

## Verification

28 tests. Mutation pass: the calories bound restored to 100,000, `int` dropped from `stepsGoal`, and
`patch.ts` restating its own bound — **three mutants, all killed**; an equivalent control
(`min`/`max` → `gte`/`lte`) survived.

Driven against `pnpm dev`: `calories` 26,000, `proteinG` 5,000 and `waterGoalMl` 50,000 now answer
**400** through `/api/coach/apply` where they previously stored, and `stepsGoal` 8,000.5 answers 400
where it previously 500'd. Legitimate writes still land — `calories` 2,400 → 2,500 and `stepsGoal`
12,000 → 150,000 both returned 200 and read back from Postgres. The user routes are unchanged: 400
for over-bound, 200 for legitimate.

## Not exercised

No device path and no APK — schema validation on server routes.

<a id="2026-09-11-lane-a-rv44-atwater-constant"></a>

# RV-44 — the nine longhand Atwater sites

**Branch:** `lane-a/rv44-atwater-constant` · **Lane A** · no migration, no native change.

`atwater.ts` exists because LB-9 found these factors written out in four places, and its header says
so: *"Six lines with no dependencies can be imported from anywhere, which is the property that stops
a fifth copy appearing."* Two files never imported it. `scan-totals.ts` had five longhand sites and
`meal-split.ts` four; `atwater.ts` was named only in comments.

All nine now import `KCAL_PER_G`. **No number moves** — every site already agreed at 4/4/9, which is
why the entry called it a consistency finding and warned against filing it as a wrong value.

## Why it was worth a control rather than just a green gate

A substitution that changes no output is indistinguishable from a substitution that changed nothing
at all — the tests pass either way, so passing tests prove only that the constant happens to match.
Setting `KCAL_PER_G.fat` to 10 and `protein` to 5 each failed **31 tests**, which is what actually
establishes the nine sites read the constant rather than sitting beside it.

## A note on the entry's own advice

RV-44 said it was *"worth doing when someone is next in those files rather than as a standalone
PR."* It shipped standalone anyway, after sitting at the top of the queue for a week with nothing
ahead of it — "when someone is next in there" had not happened and had no reason to. The advice is
sound about cost and wrong about likelihood: an item that only ships as a passenger needs a driver
to eventually turn up.

## Also worth recording

The mutation pass's baseline run exited **1 while reporting 2,621 passed and 0 failed** — the
LA-101 signature documented in `local-dev-database.md` hours earlier. It re-ran clean, which is the
response that file prescribes. The specific error line was overwritten by the next mutant before it
could be read, so this is a signature match rather than a confirmed third sighting.

## Not exercised

No device path, no APK, no API route changed — two pure functions in `packages/shared`.

<a id="2026-09-11-nutrition-macro-denominator-explainer"></a>

# 2026-09-11 — the gap explainer says the wrong thing, and the base is still climbing (BF-142)

Third owner report in the same family — *"calories still not right"* — this time against the
Nutrition card with BF-134's explainer paragraph already shipped on it. Docs-only intake; no code
changed.

## The sentence is false, and its own module says so

`nutrition_targets` holds **1,660 kcal · 150 P / 141 C / 55 F**, written 2026-08-31. The card renders
**150 P / 185 C / 72 F = 1,988 kcal** — carbs and fat at 1.31× their stored values, protein alone
untouched. `energy-card.tsx:27-29` documents the prop as Q-323's *earned-scaled* macro grams; the
sentence at `:181-183` tells the owner the grams come from his stored daily goal, four lines below
the comment saying they do not.

The reason it offers is worse than the mislabel. `macro-budget-gap.ts:8-9` states that both numbers
carry the same `earned`, so it cancels — movement cannot be what separates them. The card explains
the gap as grams-from-goal versus a budget including today's movement, so a reader who believes it
expects the gap to close as he moves. It never does, which is the one thing the paragraph exists to
say.

The arithmetic underneath is right: `storedGoal − (restingBase + goalDelta)` gives
`1,660 − (2,150 − 200) = −290` against the printed −295, with gram rounding covering the difference.
Only the words are wrong, which keeps the fix in Lane B.

One thing the fix must not inherit: the docstring pins the gap at "406 kcal, at every hour of every
day", grams *above* budget. The card prints 295 *below* — the sign flipped, so the two do not differ
by 111. Reading the docstring's own formula backwards for the base gives 1,454 then and 2,155 now
against the card's 2,150: **the resting base has risen ~700 kcal**. 1,454 sits just under the 1,527
BMR, which is what a resting base with the step credit removed should look like, so the estimator
did not start wrong — it inflated.

## A cleaner proof that BF-137 is live

BF-137 argues the calibrated maintenance is fitting a drug-driven weight drop, and rests that
argument on a weight trend — the confounded signal, so it invites "your window is wrong". This does
not. The owner is **158 cm**, 69.95 kg, 33, male: Mifflin-St Jeor BMR is **1,527 kcal**. The card
calls **2,150** his *resting* burn — 1.41 × BMR, 623 above it. Nothing resting is 1.41 × BMR. Because
`restingBase = maintenanceKcal − avgActiveKcal` on the calibrated path, an inflated maintenance
surfaces in a field labelled resting, and measured movement is added on top of a number already
holding a day of it.

The height is what settles it, and it is the easy thing to get wrong: at 158 cm his BMR sits ~130
kcal below a 178 cm man of the same mass, so reasoning from weight alone understates the overshoot.
Recorded on BF-137 as well as BF-142.

## What the owner is reacting to

He set 1,660 on 2026-08-31. The card offers 2,283, prints 1,988 of macros beside it, and marks 1,331
eaten as "Well under so far" in red. None of the three numbers on the card is the one he chose.
Three reports of "the calories are wrong" are that, rather than three separate arithmetic faults.

## Not exercised

No code changed and nothing was run against the app. Every figure above is from the read-only
production query endpoint or direct source read. BF-142 carries `Verify: owner` — whether the
replacement sentence reads as true is his judgement, not a test's.

## A field error of my own, caught by the owner

BF-139, BF-140, BF-141 and BF-142 were all filed with a `Verify:` line. That field means *shipped,
awaiting a look* — `next-item.js` prints it under VERIFY and the entry never reaches READY. Four
unbuilt entries were therefore filed as finished work, and the owner found it the way you would
expect: both lanes reported nothing to start.

The backlog protocol says this outright — *"A device requirement on unbuilt work is a **Verification**
line, not a gate"* — and records the same class hiding the whole `nutrition-ui-uplift` batch, then
recurring in LB-26 the same day, by a session that had read the warning. This is that mistake again
in the `Verify:` field rather than `Gate:`.

All four are converted to prose `Verification:` lines stating what the check actually is. Lane B now
reads READY (2) with BF-139 and BF-142; Lane A reads READY (14) with BF-140 and BF-141 at the top.

<a id="2026-09-12-admin-gifs-surface-colour-baseline-banner"></a>

# 2026-09-12 — three owner reports: the baseline banner, the admin GIF console, and the grey

Intake only; no code changed.

## BF-146 — a correct refusal drawn as a failure

Minutes before training, the Lower card showed *"Couldn't generate your AI prescription just now —
showing your base program. Tap refresh to try again."* Nothing is broken. Generation returns
`{ ok: false, error: 'Baseline not complete', status: 400 }` when a session is in `baseline` with no
anchors, which is right: a prescription is a percentage of a 1RM and there is no 1RM yet.

The client has no case for a deliberate refusal. `pre-workout-screen.tsx:301-305` renders that
banner under `prescriptionGenTimedOut`, so a settled state is drawn in amber with a warning triangle
and an instruction to retry that can never succeed. The panel directly above it already gives the
correct explanation — "First session — establish baseline … the AI will start prescribing from the
next session" — so the screen contradicts itself.

BF-143's fix is what made this reachable, and the entry says so. Before it the owner's sessions were
either AMRAP-calibrated or silently auto-completed, so the state never survived a card open. The 400
predates it; the UI gap was latent.

## BF-147 — the admin exercise list

The name is rendered and then crushed to zero. `exercise-manager.tsx:545` gives it `truncate`, whose
min-width resolves to 0; the `SourceBadge` beside it has neither `shrink-0` nor `overflow:hidden` so
it cannot collapse, and the thumbnail, status glyph and four-button group are all `flex-none`. The
name is the only thing that can give, so it gives everything — the `bod…` on screen is the second
line, which sits alone in the flexible column.

Two destructive actions have no confirmation. Delete fires on one tap, which is BF-124's defect in a
second place — the same unconfirmed trash icon that cost the owner his Lower session four days ago.
And the per-row Mirror and AI buttons pass `force = hasS3Gif`, so tapping one on a row that already
has a good GIF overwrites it silently. The bulk buttons are the safe ones, which inverts the
expectation.

The coverage figure is wrong in both halves: the denominator counts 4 merged-away rows and the
numerator ignores custom URLs. Measured: 152 live exercises, **15** with no media at all, against
the 19 that "137 / 156" implies.

The broken reference thumbnail is the style anchor for every future generation, and it is a storage
failure — the shared S3 client reports `SignatureDoesNotMatch (403)`. Of 139 media rows, 133 are
absolute external URLs and only 6 are proxy paths, which is why the rows render while this one does
not. Those six share the reference figure's fate.

Flagging is new surface: no review or status column exists anywhere on the exercise or media tables,
and the Feedback tab has no entity linkage. The recommendation is a `review_status` on
`exercise_media` plus a one-at-a-time sweep screen — verifying 152 GIFs by scrolling a cramped list
is the wrong instrument, and "decide how to proceed" needs a queryable set, not a toast.

## BF-145 — the grey is structural

Every dark surface token in `globals.css` carries **chroma 0**: background, card, popover,
secondary, muted, muted-foreground. The app is greyscale by construction and the only colour that
can appear is `--brand` on top. The owner already has a `brandHue` preference; it drives the accents
and cannot reach the surfaces. `--card-tint-pct` looks like the hook and is not — it mixes `--muted`
with transparent, so it changes the opacity of a grey.

Separately, `components/ui/sheet.tsx:133` paints `bg-background` on every `SheetContent`, and
`docs/mobile-ui-and-performance.md:97` says screen backgrounds must go through `bg-page` rather than
opaque paint because it "silently hides any wallpaper layer". The rule was written about screens;
the sheet primitive does it to **49 files**. The owner's screenshots show it — the gradient survives
above the sheet edge and dies below it.

## Not exercised

No code changed and nothing was run against a browser. Figures come from the read-only production
query endpoint and direct source reads.

## BF-148 — fixed the same night, and my filed diagnosis was wrong

The owner opened his recalibrated Lower session and got a normal workout: header reading
"Baseline · S1 · Ex 1/5" above a set card prescribing 3 × 92.5 kg × 8.

I filed this blaming the program-phase engine and the `leader.phaseStatus` collapse. That collapse is
real, but it is not what he hit. The operative term was a third condition on `isAiDynamicBaseline` in
the same route:

```ts
const hasAnyPriorLog = priorLogsThisProgram != null && exerciseNames.some(name => priorLogsThisProgram.has(name))
```

`exerciseNames.some(...)` — the identical name-keyed shape BF-143 and BF-144 already corrected in two
other places, here for a third time. Lower's exercise names were logged in this program before the
rebuild, so the flag was true and the baseline was vetoed.

It is removed rather than repaired, in both paths, taking the now-unused `priorLogsThisProgram` fetch
with it. It was a proxy for stale periodization state, and BF-143 made that state trustworthy: the
auto-heal only completes a baseline on evidence that this session was interrupted. `generate-prescription`
already trusts the same pair to refuse a prescription, and the header and pre-workout panel already
render from it — so the set card now agrees with the rest of the screen rather than holding a second
opinion.

A date-keyed repair was considered and rejected. A log newer than `phaseStartedAt` appears the moment
the first set is logged, which would drop the AMRAP display half way through the workout it exists
for. BF-143's auto-heal can use that test because flipping true mid-session is correct there.

The test asserting the old behaviour was replaced deliberately, and both surviving terms are
mutation-checked. The first attempt pinned only one of them and the mutation survived, which is why
there are three cases rather than one.

**Not exercised:** the authenticated body of the route was never run by a browser. `pnpm dev` confirms
both paths load and return 401 without a session cookie; no real session was available.

## BF-150 — the owner's call on which number he eats to

He asked when the budget would return to the figure he expects, "the 1350+ exercise". The honest
answer was: not on its own, and not soon. Measured from his screenshots, the base went 2,150 on the
11th to 2,196 on the 12th — **+46 kcal in a day** — because the calibrated maintenance is fitting a
retatrutide weight drop and reading it as metabolism. At 2,196 it is 1.44 × his 1,527 BMR in a field
the card labels *resting*, and the gap against what he expects is ~646 kcal.

He also cannot opt out. `resolveMaintenance` returns `source: 'calibrated'` the moment either window
fills, unconditionally — no override anywhere in the app. So every day that passes re-anchors him
higher and nothing he can touch changes it.

Two routes were put to him: fix the estimator (BF-137's drug-window exclusion), or anchor the daily
budget to the goal he already set and leave the estimator as information. He chose the second and
asked for it at the top of the queue, so BF-150 leads Lane A.

The reasoning for that recommendation, recorded because it is a product decision rather than a bug
fix: excluding the drug window is the principled repair, but it needs a judgement about when the
data is trustworthy again, and until then he would still be eating to a number he did not choose.
Anchoring to the stored goal is one line of intent, reversible, and correct regardless of where the
estimator eventually settles. It also closes BF-142's gap from the other side — with the budget and
the grams sharing a denominator, the paragraph explaining why they differ stops being needed.

What it gives up, stated so it is not re-opened as a defect later: the app stops auto-adjusting his
intake as his metabolism changes. That is the trade, it is deliberate, and it is revisitable once he
is off the drug — which is the point at which BF-137 becomes the right tool.

<a id="2026-09-12-bf145-tinted-dark-surfaces"></a>

# 2026-09-12 — BF-145: the dark surfaces carry the user's brand hue, and the entry's own recipe was measured and found short

**Branch:** `feat/bf145-tinted-dark-surfaces` · **Lane B** · `app/globals.css`, `app/layout.tsx`,
`components/theme-color-picker.tsx`, `scripts/check-contrast.js`, backlog, changelog.

Owner, on the Edit Program sheet: *"Needs a major uplift + addung in a color scheme instead of the
plain black"*.

## The hue had nowhere to go

`brandHue` has been a stored preference for months and it drove `--brand` alone. Every dark surface
token read `oklch(L 0 0)` — background, card, popover, secondary, muted, accent, sidebar — so the app
was greyscale by construction and the accent was the only colour that could appear on top of it.

`--brand` is a whole colour; CSS cannot sample one component out of it. So the fix is a second
variable carrying the hue **angle** alone, and the surfaces built from that. `--brand-hue` is now set
everywhere `--brand` is, which is four places and not one:

- `app/globals.css` `:root` (149, green) and one line in each of the eight `[data-brand]` blocks.
- `app/layout.tsx:51` — the **pre-paint inline script**. Miss this and the surfaces render grey and
  then tint, which is the skeleton-flash class the mobile rules already ban.
- `components/theme-color-picker.tsx:43` `applyCustomHue` — sets it.
- …`:61` `applyBrandTheme` — **removes** it. An inline value outranks the `[data-brand]` block it is
  switching to, so a leftover hue would tint every surface for the colour just moved away from.

Verified in Chromium against the running app: the variable resolves for all eight presets, follows a
custom hue, and falls back to 149 when cleared.

## The entry's recipe would have shipped an invisible change

BF-145 prescribed chroma **0.01–0.03 with lightness untouched**. Built exactly that, then measured
the painted pixels rather than trusting it: `--card` at L 0.09 with chroma 0.018 is sRGB **`1,3,1`**
— a channel spread of 2 out of 255. `--background` at L 0.05 is `0,1,1`. There is no hue to see at
those lightnesses whatever the chroma, and the screenshot confirmed it: still a black app.

**The greyness was dominated by lightness, not by chroma.** So the ramp is lifted as well as tinted:

| token | was | now | sRGB at hue 210 |
|---|---|---|---|
| `--background` | `oklch(0.05 0 0)` | `oklch(0.145 0.020 var(--brand-hue, 149))` | `2,12,15` |
| `--card` / `--popover` / `--sidebar` | `oklch(0.09 0 0)` | `oklch(0.185 0.028 …)` | `2,22,26` |
| `--secondary` / `--muted` / `--accent` / `--sidebar-accent` | `oklch(0.13 0 0)` | `oklch(0.225 0.034 …)` | `4,32,36` |

Chroma still rises with lightness — a fixed one reads as a cast on the page and as nothing on the
panels. Foreground tokens keep chroma 0; tinting text is how a dark theme goes muddy.

**Contrast went the right way on every pair**, measured in-browser: foreground/background 18.9:1,
foreground/card 17.8:1, muted-foreground/card 8.36:1 — against a 4.5:1 floor. The card-to-page
separation the entry warned about **widens**, 1.010:1 → 1.066:1, so a card stops relying on its
border to read as a card. Only four `bg-black` sites exist and all are deliberate full-screen
blackouts (PiP, camera preview), so nothing now mismatches a lifted page.

## The contrast check could not see the new tokens, which is why it failed correctly

`scripts/check-contrast.js` parses literal `oklch(L C H)` triples out of `globals.css`. A `var()`
hue matched nothing, the dark palette came back empty, and its identity guard stopped the run rather
than reporting light-only numbers twice — the failure mode it was written to prevent, working.

Taught it the hue variable, and **not by reading the `var()` fallback**: that would measure one hue
out of 360 and call it the palette. A variable-hue token is now scored at its **worst hue over the
whole circle** (3° steps), and the failing key names that hue. Proven by mutation — `--muted` at
`oklch(0.45 0.12 …)` reports `dark:muted-foreground on muted (worst hue 192°): 2.96:1`, and the
shipped ramp passes 20 of 20 with none grandfathered.

## The sheet half is refuted, not skipped

BF-145's second half says to make `SheetContent` translucent so the wallpaper shows through.
`components/ui/sheet.tsx:70-87` already records BF-75 trying that and measuring why it cannot work:
the wallpaper is at `z-[-1]` while `SheetOverlay` and `SheetContent` are both `z-50`, so a
transparent sheet reveals the overlay's `bg-black/50`, not the tab behind it — and dropping the
overlay takes the dimming that keeps small grey text legible on a dense sheet. BF-75's answer was to
*paint* the palette inside the sheet (`SheetSurfaceLayer`), and that shipped.

What is actually left is adoption, and it is the owner's call: `surface="page"` is opt-in at **five
of 46** `SheetContent` files, and `sheet-page-surface.test.ts:63` pins that list on purpose. The
wallpaper also ships **off**, so for a user who never enabled it there is nothing to reveal. Left in
the backlog with the recommendation to re-ask rather than widen — the tint now reaches all 46 sheets
through `--background` regardless.

## Verification

`pnpm check:rules` **Ran 73 of 73**. `tsc --noEmit` and `eslint` clean. `pnpm test` — **700 files,
7213 tests, 0 failed**. `check-contrast.js` 20 of 20. Rendered and pixel-sampled in Chromium at the
412×915 S25 viewport against the local database: Home, Config, and the Edit Program sheet the owner
reported.

**Not exercised — this is a colour change and the sandbox is the wrong instrument for two of its
risks.** Samsung's WebView, where OLED renders near-black differently from a desktop panel, and the
device's own display calibration: whether `2,12,15` reads as "tinted dark" or "washed out" on the
S25 is a judgement only the phone can settle. No safe-area, gesture, native or offline-first path is
touched. Recorded as a `Verify: device` on the entry and as a Known-Issues row.

**If the owner wants more or less colour, three numbers move it** — the lightnesses `0.145` /
`0.185` / `0.225` in the `.dark` block. `check-contrast.js` will say if a move breaks a pair.

<a id="2026-09-12-bf147-admin-exercise-manager"></a>

# 2026-09-12 — BF-147: the admin Exercises tab, and a stated cause that measurement overturned

**Branch:** `fix/bf147-admin-exercise-manager` · **Lane B** ·
`components/admin/exercise-manager.tsx`, `components/admin/gif-review-sweep.tsx` (new).

Owner, on the Admin Console → Exercises tab: *"ui is bad and I also want a better way to make sure
everything has the right gif. Maybe a way for me to flag if its wrong so we can decide how to
proceed."* Lane A's half — migration 273 and `/api/admin/exercise-media-review` — landed the same
day and nothing read it.

## The unreadable name is the action row, not the badge

The entry's diagnosis: `SourceBadge` has no `shrink-0`, so the name is the only flex item that can
give and it gives everything. Measured at 412 dp against the running app before changing anything:

| part of the row | width |
|---|---|
| thumbnail | 40 px |
| **flexible column (name + equipment)** | **50 px** |
| status glyph | 14 px |
| **the four action buttons** | **204 px** |

The badge is **25 px**. The row is 340 px of content. **The action group is 60% of it**, because
`globals.css`'s 48 dp tap-target floor inflates each 12 px icon to 51 px — so the name got **19 px**
of the 87 it needed, and the `bod…` in the owner's screenshot was line two surviving in the same
50 px. Fixing the badge would have moved nothing.

Shrinking the targets is a P0 violation and an overflow menu costs a tap on every action, so **the
row goes to two lines**: identity on top, actions right-aligned beneath. Re-measured after: every
name renders in full — Arnold Press 19 → 87 px, Barbell Bench Press 139 px, nothing clipped — and
the delete button is still 48×48.

That is **five entries in a row** whose stated cause did not survive contact with the code.

## Three destructive taps, one confirm

`ConfirmDialog` already existed. Delete fired on a single tap — BF-124's defect in a second place,
four days after the owner lost a session to an unconfirmed trash icon — and had **no accessible
name at all** while Edit beside it did.

The subtler pair: the per-row Mirror and AI buttons pass `force = hasS3Gif`, so on a row that
already has a GIF they replace it with no prompt and no undo. The *bulk* buttons skip such rows, so
the dangerous control was the one that looks incidental. They now confirm **only when they would
overwrite** — verified both ways: a no-GIF row (Cable Row) mirrors on one tap with no dialog, a
with-GIF row (Abs) asks first.

**Verified from the database rather than from request interception, and that correction matters.**
My first probe intercepted the DELETE and reported "no request fired" after confirming, which I
briefly read as the confirm being broken. It was the probe: `count(*)` went 146 → 145, so the
confirm had fired a real delete all along. Cancel left the row in place. The row was restored from
the migrations' own values (`007`, `030`, `036`), and the counts are back to 146/145.

## Coverage counted the wrong thing twice

`withGif / exercises.length` put merged-away rows in the denominator (they stay in the shared
catalogue on purpose, so full coverage was unreachable by construction) and counted only
`exercise_media` in the numerator — so a Custom URL from `exercise_gif_cache` drew a thumbnail on
the row and still read as uncovered, from the very source `getThumbnail` falls back to.

Locally `40 / 146` → **`42 / 145`**, and both halves match `count(*)` exactly. The list itself still
shows merged rows — an admin editing the shared catalogue needs to see them — so it now says so
rather than leaving two counts that disagree and look like a bug.

## The sweep

`gif-review-sweep.tsx`: one GIF at a time, 300 px, name and target muscles beneath, two buttons.
The queue is the live exercises with a media GIF and no verdict yet; it advances **only** on a
successful PATCH, because skipping past an unrecorded verdict is how a sweep ends up claiming
coverage it does not have. `unoptimized` on the image is load-bearing — `/_next/image` would serve
a still frame, and a still frame cannot answer whether the movement is the right one.

Driven end to end: opened at "Reviewing 1 of 40", judged one Wrong and one OK, and both landed in
`exercise_media` with `review_status` and `reviewed_at` set. Reopening showed **38 unreviewed · 1
flagged wrong**, so the already-judged filter works off the route's own GET.

Nothing regenerates. *"So we can decide how to proceed"* asks for a set to decide about, and
regenerating on the spot would destroy the evidence of what was wrong.

## Verification

`pnpm check:rules` **Ran 73 of 73** · `tsc --noEmit` and `eslint` clean · `pnpm test` **890 files /
8411 tests / 0 failed** by real exit code, with `DATABASE_URL` set so the ~190 DB-backed files
actually ran (700 without it) · `pnpm build` exit 0. Rendered, measured and driven in Chromium at
412×915 against the local database.

**The local database was mutated to reach this screen and has been put back**: `is_admin` on the
seeded user (flipped, then restored, and the auth storage state re-minted non-admin), 40 probe
`exercise_media` rows (deleted — the table is empty again), the two verdicts (gone with them), and
the deleted exercise (restored).

**Not exercised.** The S25 — this is a harness measurement at 412 dp, not glass. And **the
production S3 credentials, which the entry asked to check before writing code here**: the sandbox
boot banner reports `SignatureDoesNotMatch (403)` from the shared client. Judged orthogonal — none
of this touches storage or generation — but it still gates "AI all"/Mirror and the six proxy-path
rows, and it remains the one thing BF-147 owes.

<a id="2026-09-12-bf151-orphaned-rep-max-finding"></a>

# 2026-09-12 — BF-151 filed: the rep-max finding had no queue entry (BugFix intake)

**Branch:** `claude/bugfix-intake-agent-dk1b8g` · **Agent:** BugFix Intake

Docs-only. The BF-149 fix — inverting a bodyweight rep max through the AMRAP-scaled formula it came
from — shipped with nothing owed, so no entry stayed in the queue. But it left a *finding* behind:
the card should eventually stop inverting at all, because `exercise_logs.avg_reps` already stores the
real reps. That was recorded in
[the BF-149 journal entry](#2026-09-12-bodyweight-rep-max-inverse) and the PR body and nowhere
else, which the **No orphaned findings** rule does not accept — a documented finding without a queue
entry is a dropped finding.

**BF-151** now carries it. It is Lane A rather than a display change for one reason: the current
session's reps are already on the client (`summaryData.reps`), but the *previous* session's come from
`ex.estimated1rm` in the `workout-data` payload, which carries no reps — so the route has to return
`avgReps` before the card can stop inverting.

The argument for doing it is the one thing a better inverse cannot fix: **5 reps and 6 reps both
store 114.5**, because the rep-factor gain from the extra rep is exactly cancelled by
`amrapScaleFactor`'s 1.0 → 0.97 step at 6. `repMaxFromAmrapOneRm` returns the lower of a tie, which
is the most that stored number supports. Reading the reps removes the question rather than answering
it better.

Filed at the bottom of the queue, above the 🔵 wishlist block — the shipped inverse is correct at the
owner's rep range, so this is precision rather than a defect.

## Not exercised

Nothing to exercise; no code changed. `pnpm check:rules` ran **74 of 74**, and
`check-backlog-pointers.js` reads 342 entries with no duplicates.

<a id="2026-09-12-bodyweight-rep-max-inverse"></a>

# 2026-09-12 — a bodyweight rep max inverted with the wrong formula (BF-149)

The owner finished his recalibrated Lower session and asked why the Hanging Leg Raise summary read
**Previous 8 RM → This session 8 RM, "Consistent — solid work"** when the set above it said
**11 reps**.

No entry stayed in the backlog for this: it shipped in the same PR with nothing owed, so the queue
would only have carried a finished item. This is the record.

## A lossy round trip through two different formulas

His stored numbers reproduce it exactly.

Forward, `estimateOneRm` routes every bodyweight set through `amrapAverage1Rm` → `calcAmrap1RM`,
which is `calc1RM` scaled by `amrapScaleFactor`. At 11 reps: `calc1RM(100, 11) = 137.5`, × `0.93` =
**128** — the value in `exercise_logs.estimated_1rm` for that set, confirmed in production.

Reverse, `repMaxFromOneRm` inverts **`calc1RM`**, unscaled. The largest `r` with
`calc1RM(100, r) ≤ 128.5` is **8**.

The AMRAP discount is applied on the way in and never taken off on the way out, so every bodyweight
rep max was under-reported by exactly that factor — three reps at his range, and more above it
(0.88 past 12 reps, 0.82 past 20).

`repMaxFromOneRm` is not wrong where it already was. Its other caller, the exercise stats sheet,
builds its comparison table with `calc1RM` too, so that pair is self-consistent and says so in its
own comment. The defect was feeding a stored estimate — always AMRAP-scaled for bodyweight — to the
inverse of the unscaled formula.

## The fix, and the two decisions inside it

`repMaxFromAmrapOneRm` is new in `1rm.ts` and used by `exercise-summary-screen.tsx` for the two
rep-max values, which render only under `isBodyweight` and so cannot reach a weighted display.
`repMaxFromOneRm` and the stats sheet are untouched. Each inverse now pairs with its own forward
function — the One-Formula-One-Place reading here is not one inverse, but one per forward.

It scans for the **nearest** match rather than the largest value that fits, and that is
load-bearing. `amrapScaleFactor` steps down at 5/8/12/20 reps, so `calcAmrap1RM` dips across each
boundary — 8 reps gives 121.75 and 9 gives 120.25. The forward map is not monotone, so the
largest-that-fits search which is safe against `calc1RM` overshoots badly here: **20 reps would read
back as 28**. Nearest-match round-trips 29 of the 30 rep counts exactly. Both decisions are
mutation-checked — swapping the formula fails four cases, swapping nearest for largest fails three.

## The collision that cannot be fixed by a better inverse

5 reps and 6 reps both store **114.5**: the rep-factor gain from the extra rep is exactly cancelled
by the 1.0 → 0.97 step. No inverse can separate them, and the function returns the lower of a tie,
which is the claim the stored number supports.

That is the argument for eventually not inverting at all. `exercise_logs.avg_reps` already holds the
real figure — 11 for the set in question. For a bodyweight exercise the rep max *is* the reps, so
the card reconstructs, lossily, a number the database already stores exactly. The inverse is only
needed where a historical series has no per-set reps to hand. Worth doing when someone next touches
this card.

## Not exercised

The card was not rendered in a browser — the fix is pure display math, covered by unit tests against
the owner's own stored value (128 → 11). His next bodyweight set is its first real render.

<a id="2026-09-12-fix-bf139-header-chip-width"></a>

# 2026-09-12 — Home's three header chips fit the column they have (BF-139)

**PR:** `fix/bf139-header-chip-width` · **Lane B** · `components/device-battery-chip.tsx`,
`components/weather-chip.tsx`, `components/home/header-chips.tsx`,
`components/home/__tests__/header-meta-row-overflow.test.ts`.

Owner, with a screenshot: *"the pills in the top are a little cutoff. can we make them smaller to
fit?"*

## The entry's numbers were estimates, and they were low

BF-139 reasoned about this row by counting characters and pixel-guessing padding. It put the left
column at ~232 px and the three chips at ~201 px — which would leave 31 px spare and no bug.

Measured instead, by injecting the exact pill markup into the live header row at 412 dp and reading
`getBoundingClientRect()`:

| | before | after |
|---|---|---|
| left column | **224 px** | 224 px |
| night, no UV | 226.9 — **2.9 over** | 156.1 — 67.9 spare |
| daytime, `UV 5` | 271.0 — **47 over** | 200.2 — 23.8 spare |
| daytime, `UV 11` | 279.4 — **55.4 over** | 208.6 — 15.4 spare |

227 px of chips in a 224 px column is exactly the screenshot: the date has already truncated to
nothing and the pills sit flush against the `overflow-hidden` clip.

## Which makes the prescribed fix insufficient — as the entry itself warned

BF-139 proposed trimming `px-2.5` → `px-2` on the battery chips, *"~8 px across the two"*, and then
said to check it against the daytime case. Checked: the lever is worth 4 px a pill and 12 px across
all three, because the weather chip carries the same padding. That clears the night case and leaves
the daytime case **43 px over**.

The trim ships anyway — it is free, and it is the lever the owner actually asked for. It is just not
what makes the row fit.

## What makes it fit is one pill instead of two

Two separate battery pills cost **150 px** of a 224 px column — 67% of the row — to show two
numbers. Merged into one pill they cost **91 px**. A pill boundary is two horizontal paddings and a
gap, and the row could not afford to pay that twice. Dropping the drawn `%` is the other 12 px a
reading; a number beside a battery icon already reads as a percentage, and the full text stays in
the accessible name, so the colour-only-state rule is untouched.

**The merge is not free, and the part that needed care is staleness.** `opacity-50` used to dim a
whole pill. With two devices sharing one, dimming the container would report a fresh reading as
stale, so it moved onto each device's own span.

## Verification

Full unit suite **696 files / 8,426 tests green**; `pnpm check:rules` **Ran 73 of 73**; production
build clean; lint clean in every touched file.

The guard test gained four assertions pinning the arithmetic rather than only BF-96's wrap fix —
one `rounded-full` in the battery chip, no drawn `%`, one `opacity-50`, `px-2` on both weather
pills. **Three mutations were run and each was caught**: putting `%` back, reverting the padding,
and dimming the container instead of the span.

**No E2E spec, deliberately.** The seeded database has no weather snapshot, so `WeatherChip` renders
only its skeleton and the three-chip row cannot be assembled from real data in the harness — the
same limitation BF-96 recorded. The measurements above came from injecting markup, which is a fair
way to measure CSS and a circular way to test a component, so it stayed a probe and did not become a
spec. The mutation-checked source guard is the standing protection, as it is for BF-96.

**Not exercised:** the S25. The device look is the whole of what BF-139 still owes, and it wants the
daytime case with `· UV n` present rather than whatever the hour gives.

## What CI caught that the local gate could not

`e2e/home-device-battery-chips.spec.ts:52` asserted `toHaveText('72%')` — the drawn `%` this change
removes. Expected, and the assertion is now `'72'`; the accessible name still carries the full text,
which is the half that has to stay true.

**But the same spec caught something that was not expected, and it is the more interesting half.**
The first version of the merge put one joined `aria-label` on the pill —
`devices.map(describe).join('. ')`. With only a strap reading the spec's
`getByLabel('Strap battery 72%')` still matched, so it would have shipped looking correct. Add a ring
reading beside it and the label becomes *"Ring battery 88%. Strap battery 72%"*, that locator stops
matching, and a screen reader gets one run-on sentence for two independent facts.

Each device now carries its own name on a `role="img"` span. The role is load-bearing rather than
decoration: an `aria-label` on a generic element is ignored by assistive technology, so the fix would
have read correctly in the diff and announced nothing. The guard pins all three properties and the
mutation — restoring the joined label — was run and caught.

**The run also produced LB-56's sixth sighting, and its worst:** two `SIGSEGV`s at the familiar
address and four flaky in one 26.1-minute job, with `preferences-survive-reinstall:36` the hard
failure for the third time. `touch-target-size:53` reported *"no interactive elements found"* — the
dead-renderer downstream wearing a third mask, and the only one of the three that looks like a
genuine product failure on its own. Recorded on that entry rather than fixed here.

**The first push never triggered CI at all.** `get_check_runs` read `total_count: 0` and so did
`actions_list` — `main` had moved to `558a314205` while the local gate was running, taking #1107
(*"Carry the strap battery reading's own time to JS"*) with it, which touches the very hook this
change consumes. Merging it in and re-pushing started CI within seconds. The hook's shape is
unchanged, so the merge was clean; the near-miss was that a Lane A change to `useStrapBattery` landed
mid-flight on the one component this PR rewrites.

<a id="2026-09-12-fix-bf141-weight-dial-unit-toggle"></a>

# 2026-09-12 — The weight dial swaps to pounds by tapping its own unit (BF-141)

**PR:** `fix/bf141-weight-dial-unit-toggle` · **Lane B** · `components/workout/weight-unit.ts` (new),
`components/ui/weight-dial.tsx`, `components/workout/set-card.tsx`,
`components/workout/active-set-card.tsx`, `components/workout/active-workout-screen.tsx`,
`e2e/weight-dial-unit-toggle.spec.ts` (new).

Owner, from the logging screen for Dumbbell Lateral Raise: *"my Dumbells are pounds and I need to
convert it. im 90% in kg but some are lb ... then just have it convert to the kg equivalent"*.

This is prevention for a failure that already happened, on that exercise. Session 119 (2026-06-15)
records three dumbbell exercises logged in pounds into the kg field; the repair needed an admin
preview/apply tool that still ships, which rescaled every set and **backdated the all-time PR**.

## The entry was wrong about its own test gate

BF-141 said *"`e2e/touch-target-size.spec.ts` will fail this if it is done any other way"*. It
cannot. That spec scans `SCREENS = ['/', '/health', '/workout', '/nutrition', '/more']` — the five
tab roots. This dial lives inside an **active** workout at `/workout?session=…`, which is none of
them, so its deliberately-empty allowlist would have stayed green over a 20 px suffix.

`e2e/weight-dial-unit-toggle.spec.ts` drives into the first set and measures the control there.
Removing `.tap-target-44` turns its reachable box from `44px` to `auto` and fails it — checked.

## What the mutations caught, and the one they did not

Five mutations were run. Four failed as intended: routing the conversion through `mround125`
(three cases), reusing the kg step for lb detents, making the memory global rather than per-exercise,
and dropping `.tap-target-44`.

**The fifth passed, and saying otherwise would have been a false claim in a test name.** Removing
`stopPropagation` from the suffix left the spec green. The reason is arithmetic: the dial row is
itself a click target calling `onChange` with the row's own value, which in lb mode round-trips
kg → lb (2.5 lb detent) → kg and *is* lossy — 61.0 kg comes back 61.25. But the seeded workout starts
at **60 kg**, which round-trips exactly (132.5 lb → 60.0), so the propagation has nothing to change
in the fixture. The guard is real and seed-dependent; both the spec and the component now say so, so
the next reader does not delete it as dead weight. The test was renamed to what it proves.

## The rounding hazard, which is the thing that would have ruined this quietly

`mround125` and `mroundStep` are `Math.max(5, …)`. A 5 lb dumbbell is 2.27 kg and comes out of
either as **5 kg** — silently more than double. `fromDisplay` rounds to 0.25 kg, the precision the
2026-06-15 repair tool used for derived figures, and routes through neither. The test asserts the
clamp explicitly rather than just asserting the right answer, so the mutation that reintroduces it
fails loudly.

In lb mode the dial steps **2.5 lb**, because 1.25 kg is 2.76 lb — a grid with no dumbbell on it.

## Two things that did not go the way the entry expected

**`workout-screen.tsx` was never touched.** It is shrink-only at 1833 lines and the entry's "one
prop threaded" would have broken that. But `active-workout-screen.tsx` already holds `exercise` in
scope and is not pinned, so the thread is three unpinned files. The entry's "if the per-exercise
memory pulls in more than expected, a plan is the right call" fork did not trigger.

**The hooks had to go above the early returns.** `SetCard` has three, and `useState` inside the
`isActive` branch is `react-hooks/rules-of-hooks` — which `tsc --noEmit` does not see and CI's Build
job does. Caught locally by reading the build output properly rather than by CI, but only after
first mis-reading a `grep` for the filename as "clean" when it had printed the filename *because*
there were findings under it.

## Verification

Full unit suite **7,185 passed / 8,454 total**; `pnpm check:rules` **Ran 73 of 73**; production build
clean; lint clean in every touched file. `e2e/weight-dial-unit-toggle.spec.ts` 2/2 and
`e2e/workout-set-loop.spec.ts` still green beside it.

**Not exercised:** the S25. A scroll-snap dial with haptics beside a new inline control is a
touch-target and gesture question, and the harness drives a mouse — it can prove the box is 44 px and
cannot prove a thumb reaches it without also moving the dial.

<a id="2026-09-12-fix-bf142-gap-explainer-sentence"></a>

# 2026-09-12 — The gap explainer stops giving a reason its own module rules out (BF-142)

**PR:** `fix/bf142-gap-explainer-sentence` · **Lane B** · `components/nutrition/energy-card.tsx`,
`components/nutrition/macro-budget-gap.ts`, `app/nutrition/nutrition-content.tsx`,
`components/nutrition/__tests__/macro-budget-gap.test.ts`.

Owner, third report in this family: *"calories still not right"*.

## The words were wrong, not the arithmetic

The card printed: *"The grams come from your stored daily goal; the budget is built from your
resting burn, your goal adjustment, and the movement recorded today."*

Both halves were false in a way the file already knew about.

**The grams were not the stored goal.** `energy-card.tsx` documents that prop four lines above as
*"the **effective** targets ... Q-323's earned-scaled macro grams"*. Measured: `nutrition_targets`
holds 150 P / 141 C / 55 F; the card rendered 150 / 185 / 72 — carbs and fat at **1.31×**.

**And movement cannot be what separates the two numbers.** `macro-budget-gap.ts` says so in its own
docstring: *"Both addends carry the same `earned`, so it cancels."* A reader who believed the card
waits for a gap that never closes — which is the one thing that paragraph exists to say.

The printed numbers checked out to the kcal: `1,660 − (2,150 − 200) = −290` against a printed −295,
gram rounding covering the 5. So this was a sentence, not a recalculation.

## What it says now

Rendered against the seeded account:

> Macro targets add up to **1,900 kcal** — 463 below the calorie budget. Your stored goal is
> **1,900**. Today's budget is **2,363** — 2,063 resting burn, +300 for your goal, +0 moved. The
> grams are that goal scaled up by the same movement, so moving more raises both numbers and the gap
> stays.

Every number is named, the stored goal sits beside the computed one, and the last clause says
outright that moving will not close the gap. The card gained one prop — `storedGoalCalories`, printed
and never computed with. Resting burn, goal delta and earned all come from the balance it already
received.

**Two fixes the entry ruled out in advance and this did not take:** re-labelling the grams as
earned-scaled and stopping (true, and still leaves the reader two numbers and no guidance), and
closing the gap by scaling the stored goal up to the budget (which would raise what he eats to a
maintenance figure that is ~600 kcal too high).

## The docstring's own constant was stale, and inverting it recovered a real finding

It pinned the gap at *"406 kcal on the owner's account, at every hour of every day"*. On 2026-09-11
the card printed **295 the other way**. The sign had flipped, so the two do not differ by 111 — read
the formula backwards for the base and it gives **1,454 then** against **~2,155 now**. The resting
base has risen **~700 kcal**.

1,454 was sane: just under the 1,527 Mifflin BMR, which is what a resting base with the step credit
taken out should look like. This did not start wrong; it inflated. The module no longer restates the
number, and a test fails any attempt to re-pin it as current fact.

**That corroborates BF-137 from a direction that entry does not use.** BF-137 rests on a weight
trend, which is the confounded signal. This does not: the owner is 158 cm, 69.95 kg, 33, male, so
Mifflin BMR is 1,527 and the card calls 2,150 his *resting* burn — **1.41 × BMR**. No resting figure
is 1.41 × BMR; that is a fully active TDEE. The height is what makes it conclusive, and it is easy to
miss from the weight alone: at 158 cm his BMR is ~130 kcal below a 178 cm man of the same mass.
**Left with BF-137 and Lane A** — this PR fixed the sentence, not the base.

## Verification

A **source guard**, not a render assertion, because the defect was the words: the retracted claims
(*"grams come from your stored daily goal"*, *"the movement recorded today"*) cannot come back, the
stored goal must be named, and no gap figure may be hardcoded. Three mutations were run — restoring
the false sentence, dropping the stored-goal clause, re-pinning 406 — and each was caught. The
existing non-convergence test is kept: it is the assertion the wrong sentence contradicted.

The replacement was rendered in the Playwright harness against real data to confirm the arithmetic
prints (2,063 + 300 + 0 = 2,363), then the probe was deleted rather than kept as a spec — it asserts
a sentence that is meant to be reworded if it still reads wrong.

Full unit suite **7,189 passed / 8,458**; `pnpm check:rules` **Ran 73 of 73**; production build
clean; lint clean in every touched file.

**Not exercised:** the owner's own account. Every figure above was measured from it on 2026-09-11,
but the seeded account's numbers are different, so what the harness proves is that the sentence
renders and its parts add up — not that it reads true to the person it is for. He is the check.

<a id="2026-09-12-fix-bf146-baseline-not-a-failure"></a>

# 2026-09-12 — BF-146 closed without a code change: BF-148 had already removed the cause

**PR:** `fix/bf146-baseline-not-a-failure` · **Lane B** · `e2e/baseline-not-a-failure.spec.ts` (new),
`docs/implementation-backlog.md`.

Owner, minutes before training: *"its not able to generate an ai workout for the new one"*, under an
amber *"Couldn't generate your AI prescription just now — showing your base program. Tap refresh to
try again."*

## The report and the diagnosis were both right

`generate-prescription.ts:201` returns `{ ok: false, error: 'Baseline not complete', status: 400 }`
while `phase === 'baseline' && !baselineComplete` — correct, because a prescription is a percentage
of a 1RM and there is none before the AMRAP. The client rendered that under
`prescriptionGenTimedOut`, a *timeout* flag, so a settled state got amber, a warning triangle and a
retry that could never succeed, beneath a panel already explaining it correctly.

I implemented the fix the entry recommended, keyed on the state rather than the error string.

## Then the spec passed without it

Before shipping I wrote `e2e/baseline-not-a-failure.spec.ts`: it puts the seeded user's session into
`phase = 'baseline', baseline_complete = false` on an `ai_dynamic` program — the owner's exact state
— opens the card, waits past the poll window, and asserts no banner. It passed. **It also passed
with the fix reverted**, which is the only reason this entry is closed rather than shipped.

The banner needs `aiPrescriptionPending`, and `isAiPrescriptionPending` requires **`!isBaselinePhase`**
(`prescription-pending.ts:26`). In this state `isAiDynamicBaseline` is true, so `isBaselinePhase` is
true, so pending is false and the poll never runs. The banner is unreachable.

### Correction — the first spec could not have told me that

The reading of the source above stands, but the run that "confirmed" it was worth nothing.
`isAiPrescriptionPending` is `isAiDynamic && !isBaselinePhase && state.prescriptionStatus ===
'consumed'`, and the first fixture wrote `prescription_status = 'none'`. **With that status the two
assertions hold whatever the baseline terms do**, so passing with the fix reverted was not evidence
that the fix was dead — it was a spec that could not fail.

Corrected in this PR: the fixture writes `'consumed'`, and the guard was then measured rather than
read. Reinstating BF-148's removed veto in `app/api/workout-data` (locally, never committed) makes
the spec **fail** on `Preparing your AI workout…`; removing it again makes it pass. That is the
evidence the paragraph above was asserting, and now it exists.

**What changed is `isAiDynamicBaseline` itself.** It used to carry a third, name-keyed
`hasAnyPriorLog` term — true of any rebuilt session — which vetoed the baseline, made
`isBaselinePhase` false, let generation be attempted, and produced exactly this banner.
**`ad8938d328` (BF-148, #1117) removed that term**, hours after BF-146 was filed. The surviving
comment at `app/api/workout-data/route.ts:215` names BF-148 as the reason.

So BF-146's own recommended fix would now be dead code. It was reverted, along with its source guard
and the version bump.

## What ships

The spec, and nothing else. BF-148's change is to a *guard*; nothing pinned the user-visible
consequence, so restoring the veto would have gone unnoticed by tests. This is the verification
BF-146 asked for, kept as a regression net for another lane's fix.

The entry is removed from the queue rather than marked done — a fix nobody made is not a fix, and
CLAUDE.md's rule for a superseded plan is to close it with the reason rather than force a mismatched
implementation to clear the queue.

**If it ever returns**, the fix is not to let generation proceed — that is the borrowed-anchor
prescribing BF-143 removed. Suppress on the state (`phase === 'baseline' && !baselineComplete`),
which the pre-workout screen already computes for its baseline panel. Keying on the error string is
wider and needs text threaded through `workout-screen.tsx`, shrink-only at 1833 lines.

## The spec assumed a database only a developer has

Its first CI run was the PR's one hard failure: `test@local.dev has no session_periodization row`.
`scripts/local-db/seed.sql` ships the program as **`phase_mode = 'manual'` with no
`session_periodization` rows at all** — both halves of the fixture's premise are created lazily by
the app, so a session-aged local database has them and a fresh CI seed does not. A spec that *reads*
shared seed state and mutates it is therefore green locally and red on the first machine that has
not run the app yet.

Rewritten on `deload-visible.spec.ts`'s pattern, which had already solved this: flip `phase_mode` to
`ai_dynamic`, `INSERT … ON CONFLICT DO UPDATE` the periodization row, and put both back in
`afterAll` — restoring the prior row where one existed and deleting it where one did not, since
every other spec in a serial suite runs against this same program. The session is picked by
`ORDER BY position LIMIT 1` rather than by name, and the test navigates straight to
`/workout?session=<id>` instead of clicking through the recommendation, so nothing depends on which
session the Workout tab would choose. Verified by reproducing the CI seed locally — `phase_mode`
back to `manual`, periodization emptied — running the spec green, and confirming both were restored
untouched afterwards.

## Verification

`pnpm check:rules` **Ran 73 of 73**; `pnpm exec tsc --noEmit` and `eslint` clean.
`e2e/baseline-not-a-failure.spec.ts` passes from a CI-shaped database and restores everything it
changed; it fails, as it must, against a locally reinstated BF-148 veto. No production code was
touched, so no version bump and no changelog entry — the app behaves exactly as it did before this
PR.

**Not exercised:** the APK. This is a web-harness run, where `getLocalStore` returns null; the
device path, safe-area insets and Samsung WebView rendering are all untested here. The change is a
test fixture, so there is nothing for a device to verify.

**No `projectOverview.md` Known-Issues row**, deliberately: the user-visible fix is BF-148's, and
claiming it here would put one outcome in two places.

<a id="2026-09-12-lane-a-bf144-interruption-test-by-id"></a>

# 2026-09-12 — BF-144: the interruption test moves off exercise names onto the id link

**Branch:** `lane-a/bf144-interruption-test-by-id` · **Agent:** Implementation Lane A

## What was wrong, and it was the reason rather than the outcome

BF-143 fixed a real bug — a session rebuilt inside an existing program skipped its calibration — and
justified its name-keyed lookup with *"`workout_sessions.program_session_id` is NULL on every recent
row … an id join would answer 'never trained' for everyone"*. That measured the **dead** column of
the pair `schema.ts` warns about. The live link is the column named `session_id` (Drizzle property
`programSessionId`) and it was populated the whole time: **62 of 108 rows**, and on 2026-09-11 each
of the owner's four trained sessions carried one while the recreated Lower carried none — exactly
the question the guard needed answered, available directly and ignored.

**This is not a revert.** BF-143's date comparison is what carries the guard and it is correct. What
was wrong was the reason, and a reason left in a comment is what the next reader builds on.

## What shipped

- **`wasProgramSessionTrainedSince`** (`lib/data/postgres/slices/periodization.ts`) — joins
  `exercise_logs` to `workout_sessions` on the id link, scoped to the user, both soft-delete filters,
  `loggedAt >= since`.
- The route (`app/api/ai-periodization/session/[sessionId]/route.ts`) calls it with the session's own
  id and `phaseStartedAt`, and no longer asks `getLastExerciseLogsBatch` anything. The false comment
  is corrected in place.

## Decisions, and why

- **The date comparison stays.** Not redundant with the id: 46 of the 108 rows predate the link and
  carry no `session_id`, so the id alone cannot speak for older history — and the question is about
  training since *this* phase clock, not ever.
- **The program-scoping argument is gone, not dropped.** It was needed because a shared exercise name
  logged under a different program could skip a fresh cycle's AMRAP week. A program-session id
  belongs to exactly one program by construction, so the scope comes for free.
- **`gte`, not `gt`** — a log at the exact instant the phase started is training within it. Pinned by
  its own case, because a boundary nobody tests is a boundary that drifts.
- **The date semantics moved down into the query, so the route test can no longer own them.** They
  are covered against a real database instead, which is a better home for them than a mock that
  agrees with whatever it is told.

## Verification

- 10 DB-backed cases in `lib/data/postgres/__tests__/was-program-session-trained-since.test.ts`,
  including the one that is the whole of BF-144: **two sessions sharing the name "Lower"**, where a
  name lookup answers yes for both and the id answers correctly for each.
- The five BF-143 cases pass unchanged, which was the entry's stated bar — the behaviour was not
  meant to move, only to stop depending on names.
- **Mutation pass — 7 planted defects, 7 killed:** dropping each of the four `where` filters in turn,
  `gte`→`gt` at the boundary, and the route asking since the epoch rather than the phase clock. The
  equivalent control (`row != null` rewritten as `row !== undefined`) survived, as it should.
- Full suite green, lint green, `pnpm check:rules` — Ran 73 of 73, all passed.

## Not done

- **The dead column is still there.** Dropping it is data-losing and is the owner's call; BF-144
  stays queued with a `Gate: owner` and the recommendation written out. The gate went on the entry
  only now, after the startable half was out — putting it there earlier would have parked real work
  behind a question, which is the failure the entry itself was filed to avoid.
- **Not exercised:** no device run (server route, no device path); no production data — the 62/108
  and 46-row figures are the filing session's measurements, re-read from the entry rather than
  re-measured here.
