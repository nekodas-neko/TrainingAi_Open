# Working practices: decisions, communication, review

> Moved verbatim from `CLAUDE.md` on 2026-10-05, when it was cut from 121 KB to the short form (release train, Phase 4). `CLAUDE.md` keeps each rule as one line pointing here; **this file keeps the reasons and the incidents behind them**, which is what makes a rule hold. Some passages describe the retired seven-agent process (lanes, batons, the backlog file) — where they do, the rule they carry still stands and the mechanism around it is history.

## Decisions That Come Back To Me — answer the whole question the first time

**⚑ STRUCTURAL QUESTIONS ARE YOURS — owner, 2026-09-22: *"I'd like it if you could take a lot of
these structural questions."*** That is a standing narrowing of everything below, not a one-off.
**Architecture, tooling, process, file layout, naming, which mechanism to use, how to test
something, how the queue and the docs are organised — decide them, state the call in one line, and
continue.** Bringing one of those back reads as caution and is not: it hands the work back, and the
owner has said so outright.

**What is still theirs, and the list is short:** anything that **destroys or rewrites data**
(a data-dropping migration, a non-reversible one, a production write); **money**; **auth, sessions,
secrets**; **scoring calibration**, because a bad one is hard to notice from inside and it changes
numbers they read daily; and a **genuine product preference** that cannot be derived from the repo —
what the app should *do*, not how it should be built. When a structural choice would quietly change
one of those, it is that one, not a structural question.

**A structural call you make still gets written down** — in the entry, the journal or the rule it
becomes, with the reason and what it would cost to reverse. Delegated is not undocumented: the
owner is trading *being asked* for *being able to read it later*, and the second half is the part
that makes the first safe.

**First, don't ask.** A decision is the owner's only if it is **hard to reverse** (migration, auth,
external contract, public surface), **expensive to reverse** (it seeds a pattern the codebase will
copy), or a **genuine preference** not derivable from the repo. Everything else — naming, file
layout, which primitive to reuse, two equivalent implementations — you decide, state in one line what
you picked and why, and continue. Asking about a cheap reversible choice is not caution; it hands the
work back.

**When it genuinely is the owner's, never send a bare question.** The owner should not have to reply
*"give me the options with your recommendation and why, the alternatives and why not, the
best-practice future-proof answer rather than a quick fix, in plain English"* — that is the default
shape of every decision you bring, produced unasked:

1. **The recommendation, first line.** One named option, stated as a recommendation — not a menu.
2. **Why, framed a year out.** What it costs to live with and what it makes easy later, not what is
   fastest today. Default to the durable option; if you are recommending the quick one, say so
   outright and name the debt.
3. **Alternatives, each with the reason it lost** — and what it would genuinely be *better* at. An
   alternative with no upside is padding, not an option.
4. **Reversal cost.** If this is wrong in three months, what does undoing it take? Cheap-to-reverse
   deserves less deliberation, and saying so often unblocks the decision fastest.
5. **Plain English** — no unexplained jargon or acronyms, no file path standing in for a reason.
   Assume the reader knows the product cold and the internals not at all.

**Keep it under a minute's reading** (~15 lines). A brief longer than the work has failed. Use
`AskUserQuestion` for discrete short options, prose when the reasoning is the thing to read. **Never
manufacture a trade-off** — if one option is genuinely the only sane one, say that and proceed.
**Override:** "quick fix" / "temporary" / "spike" / "don't over-think it" flips the bias to speed for
that task, with the durable version noted in one line so the debt is on the record.

---

## Communication

- State in one sentence what you are about to do before doing it.
- Report blockers clearly rather than silently working around them.
- **When presenting work, state which failure surfaces were NOT exercised.** The recurring pattern behind "verified but broken": the failing path is unreachable in the sandbox. Every "works locally" claim must name which of these were not tested — native SQLite/Capacitor plugins, safe-area insets, drifted prod data (fresh local seed masks it), real Oura/Health Connect tokens, Samsung WebView rendering — and run `docs/device-smoke-checklist.md` as the concrete on-device verification step for each. The Canonical Runtime section above defines the device-first policy this rule enforces.
- **⛔ VERIFY WITH THE TOOL THAT OWNS THE QUESTION, NEVER WITH A GREP YOU WROTE** (OR-187, 2026-09-27, after getting it wrong twice in two days). A grep is a guess at the shape of the data; the parser, the runner or the API is the authority. **Both failures were reported to the owner as fact before being checked.** `OR-174` claimed four branches held live work, from a name matching a queued entry — diffed afterwards, not one did. A regex over the backlog reported **32 entries with no lane**; `parseEntries` said **2**, because the scan missed the bare form that 75 entries use and `lane.js` reads on purpose. **If a question has an owner — `parseEntries`, `next-item.js`, `list_issues`, `get_check_runs`, `git diff` — ask it.** A grep is for finding candidates, never for counting them or for concluding.
- **Never mark an issue fixed from intent.** Before writing "fixed" in the journal or striking a Known Issue, confirm the change exists in the committed diff and was observed working (on-device for APK-only behaviour) — a session once documented a fix that was never applied to the file, and eight fixed items once lingered unstruck.
- Ask before taking any irreversible or wide-blast-radius action — the cost of pausing is always lower than the cost of an unwanted action.

---

## Process & Review Discipline

- **Sibling-surface sweep**: when fixing or adding a pattern on one surface (a write path, a fetch+sync pairing, a display format, a scale/dial config), grep for every other surface handling the same domain and update them in the same PR — the UI analogue of the sync-push mirroring rule above. A fix applied to one surface and not its siblings is only half done.
- **No global element-selector styling**: tap-target floors, focus rings, and similar UI defaults belong in the shared component (`components/ui/button.tsx` variants), never in a bare `button`/`a` selector in `globals.css`. Any unavoidable global rule needs its opt-outs applied in the same PR, not left for a later audit.
- **Report-invalidation**: never dismiss a user-reported visual bug as "stale build" or "can't reproduce" without reproducing at the S25 viewport (≤640px) against freshly-pulled `main` — the mirror of "never mark an issue fixed from intent" above.
- **No orphaned findings**: any bug or gap written into a plan, review, or journal doc gets a backlog entry or a `docs/overview/known-issues.md` Known-Issues row **in the same PR**. A documented finding without a queue entry is a dropped finding.
- **Mutation-callback contract**: completion callbacks must carry the written entity (`onLogged(log)`), not fire as a parameterless "please refetch" after a local write — the latter is the pattern behind several of this project's stale-repaint bugs.

---

- Do not add features, refactor, or introduce abstractions beyond what the task explicitly requires.
- Do not add error handling for scenarios that cannot happen — trust internal code and framework guarantees.
- Default to writing no comments. Only add one when the **why** is non-obvious (a hidden constraint, subtle invariant, or surprising behaviour). If removing it wouldn't confuse a future reader, skip it.
- Prefer editing existing files over creating new ones.
- **Prefer pre-made components and libraries over hand-rolling UI.** Before building custom gesture handling, animation, charting, or interaction logic, check if `motion` (Framer Motion), `@use-gesture/react`, `react-chartjs-2`, `@dnd-kit`, or shadcn/ui already cover it. Installed packages: `motion` v12, `chart.js` + `react-chartjs-2`, `@use-gesture/react`, `@dnd-kit/react`.

---
