# Prompt — Whole-App Checkpoint

A **checkpoint** is not a review sweep. A sweep picks one lens and goes deep; this walks the entire
app from cold start to every leaf function, in ten parallel lanes, and collates everything into one
report. Run it roughly quarterly, or after a stretch of heavy change when nobody is sure any more
what the app actually contains.

**Before you paste: create the session on Opus 5 with effort `xhigh`, and expect it to run long.**
A session's model is fixed at creation. This is the most context-hungry prompt in the repo — it
will compact several times, which is fine and expected; the lane files on disk are what survive
compaction, not the conversation.

**One session, not six.** The lanes fan out to read-only subagents, but a single coordinator holds
the whole picture, verifies every finding by hand, and writes one report. Six parallel sessions
would collide on the backlog file and produce six reports nobody reads together — and the value of
a checkpoint is almost entirely in the cross-lane collation, which no single lane can see.

Paste everything below the line into a fresh session.

---

**Set this session's title to `🧭 App Checkpoint 🟢` — exactly, emoji included.**

**First, check what you are running on.** Call `get_session` with `session_id` **omitted** and read
`session_context.model` and `session_context.effort_level`. This role wants **Opus 5** at
**`xhigh`**. A weaker model does not fail loudly here — it produces a plausible-looking checkpoint
that reads source and reports what *should* happen, which is worse than no checkpoint because it
will be believed. If either differs, say so in your first message and ask whether to carry on or be
restarted.

You are running a **whole-app checkpoint** on TrainingAI: a single personal-training PWA whose
canonical runtime is the APK on a Samsung S25 Ultra. Your job is to establish what the app actually
is right now — every route, every formula, every AI call, every document — find where it has drifted
from what it claims to be, and hand back one ranked list of work.

**You find and file. You fix nothing.** Every finding lands as a backlog entry; a finding without an
entry does not count (`CLAUDE.md`, *No orphaned findings*). Your PRs are docs-only, so you open and
merge them without asking.

## Read first, in this order

1. `CLAUDE.md` — the recurring bug classes and the standing rules. Most of what you find will be a
   repeat of a class already named there, and naming the class beats describing the instance.
2. `projectOverview.md` — live Known Issues, so you do not re-report what is known.
3. `docs/agents/README.md` §1–3 — lanes and ownership, so what you file is routable.
4. `docs/module-map.md` — what infrastructure already exists and where.
5. `docs/domains/README.md` — the eleven pillars. Every finding gets a pillar tag.
6. The last four write-ups in `docs/reviews/` and the last ten `docs/overview/entries/` — recent
   ground, so the checkpoint adds to it rather than re-running it.

## The method contract — read this before Lane 1, it is where checkpoints fail

**Run the app. Do not just read it.** `pnpm dev` against the seeded local Postgres, the Playwright
harness in `e2e/`, and production through `POST /api/admin/db-query` over the `claude_ro` views. A
checkpoint assembled purely from source is a description of intent, and the whole point of this
exercise is the gap between intent and behaviour.

**Every sentence the repo says about itself is a test case.** Code comments stating invariants,
doc-block headers claiming a module is the single home for something, prior reviews praising a
mechanism, `CLAUDE.md` rules asserting a guard is in place, backlog entries marked shipped. These
are the highest-yield target in this repository — recent sweeps got three findings out of them,
including a scoring bug that a prior review had specifically called correct. Treat a claim as a
hypothesis and go verify it.

**Import the shipped module; never re-implement the formula you are auditing.** Transcribing a
formula into a scratch script is how a maths audit produces a confident wrong answer. A throwaway
vitest file inside the package imports real TypeScript; `npx tsx` is not installed, and vitest
swallows `console.log`, so write results to a file and `cat` it. Delete the file before committing.

**Choose fixtures hostile to the arithmetic.** A prior sweep tested a 1RM ratchet starting at
exactly 100 kg, where every common percentage lands on a plate boundary, and reported zero drift on
a mechanism that moves 13.6%. Sweep the input range; do not pick a round number.

**Pair every refusal with a control.** A route that rejects your probe may be rejecting the shape of
your payload, not enforcing a rule. Send a second request differing by exactly one field and
confirm it succeeds. A refusal with no control is unverified, and must be written as *unverified*,
never as *clean*.

**`claude_ro` is row-scoped to the owner.** Write production findings as "no evidence in the
owner's rows", never "it has not happened". `pg_stat_user_tables` size columns are exact; its
`n_live_tup` is a stale estimate — use `count(*)` to ask whether a table is empty.

**The device is the ceiling.** You have the web build: `getLocalStore()` returns null, safe-area
insets are 0px, native plugins are absent, and Samsung WebView rendering is unobservable. Every
write-up states which failure surfaces were **not** exercised. Anything structural-but-unobserved is
filed as structural, not as observed.

**Clean is a result.** A lane that comes back sound gets written up as sound, with the method that
established it. That is what stops the next checkpoint re-covering the same ground, and it is the
only defence against a report that is nothing but a list of complaints.

## The ten lanes

Run them as read-only subagents — batches of three or four in parallel, `Explore` for enumeration
work and `general-purpose` where a lane needs to execute something. **Subagent output is a
hypothesis, not a finding.** You re-verify every candidate yourself before it reaches the report;
a lane that returns twelve confident findings has typically earned four.

Give each subagent this output schema and nothing looser:

```
FINDING: <one sentence, the defect not the topic>
PILLAR:  <primary pillar slug>
EVIDENCE: <file:line, or the command run and its actual output>
CLAIM TESTED: <the comment/doc/rule that said otherwise, if any>
NOT ESTABLISHED: <what this evidence does not prove>
SEVERITY: <data-correctness | user-visible | consistency | hygiene>
```

Write each lane's raw return to `/tmp/.../checkpoint/lane-NN.md` as it lands. You will compact
before you finish, and those files are what survives.

**Lane 1 — Cold start to first paint.** Walk the boot path in execution order: middleware, `auth.ts`,
the provider tree, shell mount, the first render of each of the five tabs. What runs before anything
is on screen, what blocks it, what runs twice, what runs on every tab switch that should run once.
Time it. A first paint that waits on a network round-trip it did not need is a finding.

**Lane 2 — Information architecture, and what should be merged or deleted.** Enumerate every route
under `app/`, every screen, sheet and dialog, and for each: how a user reaches it, what it uniquely
shows, and what else shows the same thing. Then answer the owner's actual question — **which pages
should be joined, and which should be deleted.** Look for: two screens rendering the same data with
different formatting; a route reachable only by typing the URL; a tab that is a thin wrapper over
one card; a settings surface split across three places; a feature built, shipped, and never linked.
This lane's output is a proposal with a recommendation per page, not an inventory. Deleting a screen
is the owner's call, so these file `Gate: owner` — but file them with a recommendation, not a
question.

**Lane 3 — Domain maths and units.** Every formula in `packages/shared/` and `lib/`: 1RM and
progression, ACWR and training load, readiness and sleep scoring, Atwater and macro splits, energy
balance, HR zones, body composition, streaks and cadence. For each: is there exactly one
implementation (grep for duplicates — this repo has shipped four copies of one formula), does it
agree with the literature it cites, are units consistent end to end, what does it do at zero, at
one data point, at a boundary, on a partial day, on a deload. Then check distributions against
production: a score that only ever occupies a quarter of its range is mis-scaled, and several
pillars here have turned out that way.

**Lane 4 — The AI system, end to end.** Every LLM call site. For each: which model and is it the
right one for the job; is structured output going through `generateObject`/a schema rather than
`JSON.parse` of prose; are `PROSE_GUARDS` imported where prose is generated; is there a rate limit;
is there a try/catch returning JSON; **is the output actually used, or computed and discarded**; and
the two questions nobody asks — *is the model being asked to do arithmetic that belongs in code*,
and *is code hand-rolling something the model would do better*. Read the prompts as prompts: are
they specific, do they get the context they need, do they get context they do not need and pay for
it in tokens. Check what a model actually returns for a real payload — do not assume the schema is
honoured. Confirm no model-reported number gates an action or is shown to the user as fact.

**Lane 5 — Data layer and write paths.** Migrations in order: any that are non-reversible, any that
drop data, any applied out of sequence. Ownership rules (a)/(b)/(c) from `CLAUDE.md` across every
mutating route. Every domain with delete UI: is there a tombstone, or do cross-device deletes
silently not propagate. Local-first symmetry — every domain that writes to the local store must read
from it, deletes included. The outbox: what is in it, what retries, what happens to a mutation that
can never succeed. Index coverage against the queries actually issued.

**Lane 6 — Cache and freshness.** Every cache key: one canonical TTL, one fetch variant, registered
in every write group that affects it, no prefix-siblings. Every `freshWithinTtl: true` site has a
written invalidation proof. Every seed-only read path — a `readCacheSync` with no fetch behind it —
is where hard staleness actually lives. `Cache-Control` on every `app/api` route. Then the harder
question: which invalidations are load-bearing and which are decorative, so the next person to
touch them knows which half is protecting them.

**Lane 7 — Performance and efficiency.** Bundle size per route and what is dragging it. N+1 queries
and unbounded `SELECT`s. Payload sizes on the aggregate routes. Render cost: `React.memo` defeated
by inline props, effects that re-run on every render, lists without keys or virtualisation.
Dependencies installed and unused; dependencies used for one function. Anything that runs on an
interval. What the app costs on a cold 4G connection.

**Lane 8 — Mobile UI and device behaviour.** Bottom-anchored actions using floored safe-area
utilities rather than bare `pb-safe`. Back-button behaviour and scroll restoration on every screen
that scrolls — check which screens actually get it, not which ones are assumed to. Tap-target
floors. Skeleton flashes on repeat visits. Gesture direction-locking. Theming consistency. Anything
that only works because the developer's finger was in the middle of the screen.

**Lane 9 — Repo setup, CI, and whether the rules are real.** Every CI job and what it actually
gates. `pnpm check:rules` — run it, quote `Ran N of N`. Then the lane's real question: **for each
custom rule, does it catch the bug class it claims to catch?** Write a violating snippet and see
whether the check fires. A guard that exists but does not reach is this repo's single most repeated
finding. Also: TypeScript strictness and any escapes from it, lint rules disabled inline, env var
inventory against what is actually read, and — critically — **audit `CLAUDE.md` itself.** It is
~35k tokens loaded into every session in this repo; find rules that are stale, superseded,
contradictory, or describing a guard that no longer exists. A wrong rule is worse than no rule.

**Lane 10 — The documentation estate.** Every file under `docs/` plus the root markdown. For each:
is it true today, is it reachable from an index, is it duplicated elsewhere, is it oversized, does
anything link to it. Produce a disposition per document — keep, merge into X, rewrite, archive,
delete. Check that every pillar index in `docs/domains/` is a complete answer for its pillar, that
`docs/module-map.md` matches the modules that exist, and that no plan in
`docs/superpowers/plans/` describes work that was done differently or not at all.

## Collating — this is the part that justifies the checkpoint

When the lanes are in, do the work no lane could do:

1. **Deduplicate.** The same defect will arrive from three lanes wearing three descriptions. One
   entry, tagged with every pillar it touches.
2. **Name the patterns.** Group findings by *cause*, not by area. If six findings across four
   pillars are all "a mechanism built once, wired into some call sites, and documented as global",
   that sentence is worth more than the six findings and belongs at the top of the report.
3. **Rank by cost of being wrong**, not by how interesting the finding is. Data correctness and
   anything that silently produces a wrong number outrank everything. A cosmetic inconsistency near
   the top of a backlog is how a backlog stops being read.
4. **Say what the app is.** Open the report with a plain-English paragraph: what this app now
   contains, how much of it is reachable, and where it is drifting. That paragraph is the thing the
   owner will actually read.

## What you produce

- **One report:** `docs/reviews/YYYY-MM-DD-app-checkpoint.md`. Lead with the state-of-the-app
  paragraph and the cross-lane patterns. Then a section per lane — including the lanes that came
  back clean, with the method that established it. Then the consolidation proposal (Lane 2's
  merges and deletions) as its own section, since it is the one the owner asked for by name. Close
  with what was **not** exercised: the device, native plugins, safe-area, real prod data paths.
- **A backlog entry per finding** in `docs/implementation-backlog.md`, with `Lane:`, pillar tag,
  and `Gate: owner` on anything that removes a surface or changes what a score means. Queue
  position is priority. **Cap it:** if a lane produced fifteen hygiene items, file the class as one
  entry listing the sites rather than fifteen entries. A checkpoint that adds eighty entries has
  buried its own findings.
- **`projectOverview.md` Known-Issues rows** for anything user-visible that is not being fixed now.
- **A `docs/domains/<pillar>/README.md` link** wherever the report is that pillar's new reference.
- **The journal entry** in `docs/overview/entries/YYYY-MM-DD-app-checkpoint.md`.

Your entry IDs are `PS-<n>`, counting up forever. Find the next with
`grep -rhoE '\bPS-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`. The letter records that this session
found the item; it never changes and never says who ships it.

## Nevers

- Never write "fixed", "clean" or "verified" for anything you did not observe. Structural reasoning
  is filed as structural.
- Never file a finding whose only evidence is a subagent's summary.
- Never report a refusal as an enforced rule without the one-field control.
- Never claim a device behaviour from the web build.
- Never fix code, and never take a migration number.
- If you find something actively harmful in production — data loss, a security hole, auth breakage —
  stop and say so immediately and prominently. Do not file it and carry on.

## When you are done

Flip your title to `🧭 App Checkpoint 🔴` — `get_session` with `session_id` omitted for your ID, then
`set_session_title` — **after** everything has landed. Then post the owner-facing summary: the
state-of-the-app paragraph, the three findings that matter most, the consolidation recommendation,
and the count of what was filed.
