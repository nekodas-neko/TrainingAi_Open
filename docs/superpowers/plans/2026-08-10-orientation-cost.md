# Plan — cut what every session must read before it can start

_2026-08-10 · Domain `platform` · Raised by the owner during the public-repo migration._

## The measurement

`CLAUDE.md`'s first standing instruction is to read `projectOverview.md` first, and describes it as
**"a lean index"**. Measured today:

| File | Lines | Bytes | ≈ tokens |
|---|---|---|---|
| `CLAUDE.md` (loaded automatically, every session) | 918 | 107 KB | **~27,000** |
| `projectOverview.md` (read first, every session) | 8,068 | 669 KB | **~167,000** |
| | | | **~194,000** |

**Every session is instructed to read roughly 194,000 tokens before doing anything.** That is more
than many context windows, and it is paid before the first useful action. The "lean index"
description is wrong by a factor of about forty — not as an insult to whoever wrote it, but because
the file grew an entry per PR for months and nothing was ever specified to remove one.

Where `projectOverview.md`'s bulk actually is:

| Section | Lines | Share |
|---|---|---|
| Known Issues & Risks | **5,821** | 72% |
| Current Status | 2,083 | 26% |
| What's Left To Do | 95 | 1% |
| Document Map | 48 | <1% |

## The part that matters: this is not a formatting problem

Known Issues holds **267 entries averaging 22 lines each**. Of those, **63 are resolved** (✅ or
struck) and **204 are open**.

So archiving everything already fixed removes 1,338 lines — **17%**. Worth doing, and nowhere near
enough. The remaining 4,626 lines are 204 genuinely-open issues. **The file is big because the
backlog is big**, and any plan that presents tidying as the fix is misreading it.

That gives three levers, in increasing order of value and effort.

## Lever 1 — archive what is already resolved (easy, safe, 17%)

Move the 63 resolved entries to `docs/overview/known-issues-resolved.md`. Mechanical, verifiable by
entry count and by diffing the concatenation, and it cannot lose information.

**Then add the rule that keeps it true**, in `CLAUDE.md`'s end-of-session ritual: striking a Known
Issue means *moving* it to the archive, not marking it ✅ in place. Without that line this grows
straight back.

## Lever 2 — route issues by domain (the structural fix)

`CLAUDE.md` already tells sessions to read `docs/domains/<pillar>/README.md` when working in an
area, and every Known-Issues heading already carries its `[domain]` tags — the routing exists and is
greppable. What does not exist is a reason to read the pillar's issues instead of all 204.

Move the open entries into `docs/domains/<pillar>/known-issues.md`, and leave `projectOverview.md`
with counts per pillar plus the handful that genuinely span everything. A session working on sleep
then reads sleep's issues.

**The risk to design against:** an issue tagged `[platform][sleep]` must not become invisible to a
platform session. Primary tag owns the entry; other tags get a one-line cross-reference. That is a
real cost, and it is why this is Lever 2 and not Lever 1.

## Lever 3 — cap entry length

22 lines per known issue is a short essay. Most of that context belongs in the journal entry the PR
already wrote. A cap — a paragraph plus a link — would cut the section far harder than either lever
above, but it means rewriting 204 entries and losing detail that is sometimes load-bearing.

**Do this last, incrementally, on touch** — rewrite an entry when you are already in it. A
big-bang rewrite of 204 entries by an agent that did not live through them will quietly drop the
detail that made a few of them worth keeping.

## `CLAUDE.md` itself

918 lines, and it is the reason this project stopped repeating twelve classes of bug — so trimming
it is not free and "make it shorter" is not the goal. The defensible move is the same as Lever 2:
the bug-class sections that are domain-specific (Oura BLE, offline sync, local SQLite migrations,
safe-area) could live in the pillar docs a session already reads when working there, leaving
`CLAUDE.md` the rules that bind everywhere — timezone, cache invalidation, git workflow, the
communication and verification standards.

**Do not start this before Lever 2.** The domain docs have to be worth reading first; moving rules
into files nobody opens is how a rule stops firing, and this repo has already paid for that once
(`pt-safe-or-4` referenced but undefined for a whole release).

## Sequencing and honest sizing

1. **Lever 1 + the retention rule** — one PR, low risk, ~17%.
2. **Lever 2** — its own PR per pillar, or a few. This is the one that changes the number.
3. **Lever 3** — never a PR of its own; a habit.
4. **`CLAUDE.md` split** — only after 2 has proven the domain docs get read.

Levers 1 and 2 do not block the public-repo migration and should not be bundled into it. They do
make every session after it cheaper, which is the argument for doing them soon rather than never.
