---
name: task-observer
description: Watch the session for moments that should become durable knowledge — a user correction, a rule that failed to fire, the same manual work done twice, a near-miss caught late — and convert them into backlog entries, CLAUDE.md rule proposals, Known-Issues rows or skill edits. Use at session wrap-up, after the user corrects an approach, after a review finds a repeat of a known bug class, or when the user says "task observer", "what did we learn", or "capture that as a rule".
version: 1.0.0
---

# Task Observer

Adapted from [rebelytics/one-skill-to-rule-them-all](https://github.com/rebelytics/one-skill-to-rule-them-all)
(CC BY 4.0), rewired to feed this repo's existing rituals instead of a parallel observations log.

The bet behind CLAUDE.md is that a bug class caught once should never cost a second session. That
only works if the lesson gets written down at the moment it is learned. Most of the time it does not
— the correction happens in chat, the session ends, and the container is reclaimed. Cache
invalidation has been "fixed" in sessions 104, 125, 166, 171 and 173.

This skill closes that loop. It observes, then routes each observation to the surface that already
exists for it.

## No new doc surface

Observations do **not** get their own log. They land in the places the next session already reads:

| Observation | Destination |
|---|---|
| Recurring bug class, or a rule that exists but did not fire | A **CLAUDE.md rule** edit — usually sharpening an existing rule, not adding one |
| A gap found but not fixed | `projectOverview.md` Known Issues row, domain-tagged |
| Work worth doing later | `docs/implementation-backlog.md` entry at a judged priority |
| A repeated manual procedure | A new or extended **skill** in `.claude/skills/` |
| Knowledge specific to one pillar | `docs/domains/<pillar>/README.md` |
| New shared module or infrastructure | A row in `docs/module-map.md` |
| What this session did and decided | The session's `docs/overview/entries/` file |

Everything rides in the **current session's PR**. CLAUDE.md is explicit: a finding without a queue
entry is a dropped finding, and the journal update must land in the same PR as the work so an
abandoned PR never leaves a stale claim behind.

## What counts as an observation

Log something when one of these fires. Not every turn produces one — most do not.

**1. The user corrected you.**
The highest-signal event available. Ask which kind:
- *Preference* ("use pnpm not npm") → likely already a rule; if CLAUDE.md has it, the rule failed to
  fire and needs sharpening or relocating, not duplicating.
- *Missing context* ("the ring is on our key now") → a doc gap. Route to the domain index.
- *Wrong approach* ("don't hand-roll that, `@use-gesture/react` is installed") → a rule or a
  module-map row.

**2. A rule existed and still did not fire.**
The most valuable observation in this repo and the easiest to miss. If CLAUDE.md already forbade
what you just did, adding the rule again is worthless — ask *why it did not fire*. Usually one of:
the rule is buried in a section nobody reads for that task; it is phrased as a principle rather than
a grep-able pattern; or it lives in CLAUDE.md when it should be a CI check.

**Prefer a CI check over a prose rule** whenever the violation is grep-able. The safe-area,
push-mutations and PPL-session-name rules all graduated from prose to
`.github/workflows/ci.yml` / `scripts/check-*.js`, and stopped recurring.

**3. The same manual work happened twice.**
Two occurrences of a multi-step procedure is the threshold for a skill. One is a task.

**4. A near-miss.**
Something caught in review or testing that would have shipped. Note what caught it — and whether it
was luck. If a class of bug is only caught by luck, that is a gap in the gate, not a win.

**5. A plan went stale before implementation.**
The backlog assumes plans survive the queue. When one did not, note why so the next planning session
scopes differently.

## Method

Do not narrate observations as they happen — it clutters the session. Hold them, and produce the
list at wrap-up or when asked.

For each observation, answer four questions before writing anything:

1. **What actually happened?** Concrete, with the file, function or PR. "Missed cache invalidation"
   is not an observation; "`invalidateProgramStructure()` did not clear `ta_recommendation_v1`, so
   home re-painted the pre-edit session list after a Config save" is.
2. **Is it already covered?** Grep CLAUDE.md, the domain index, and the backlog. If a rule exists,
   the finding is *"the rule did not fire"*, and the fix targets the rule's placement or
   enforceability.
3. **Will it recur?** A one-off does not earn a permanent rule. CLAUDE.md is already long, and every
   added line dilutes the ones that matter. Adding a rule has a cost.
4. **What is the smallest durable form?** In descending order of preference: a CI check → a sharper
   existing rule → a backlog entry → a new rule → a new skill. Reach for the last two rarely.

Then propose, and let the user decide. **Never edit CLAUDE.md unprompted** — it is the highest-
leverage file in the repo and its rules are load-bearing. Backlog entries, Known-Issues rows and
journal entries are yours to write; CLAUDE.md changes get presented for approval.

## Output format

At wrap-up, present observations most-durable-first:

```
## Observations

1. RULE DID NOT FIRE — cache invalidation (session's 4th occurrence of this class)
   What: invalidateProgramStructure() missed ta_recommendation_v1/ta_meta_v1.
   Covered by: CLAUDE.md "Cache Invalidation" already forbids this.
   Why it did not fire: the rule says "register the key in every write's group" but there
     is no way to check that without reading every group helper.
   Proposal: a scripts/check-cache-groups.js CI rule asserting every readCacheSync key
     appears in at least one group in lib/cache-groups.ts.
   → Backlog entry, not a CLAUDE.md edit. Needs your call on priority.

2. GAP — Kotlin changes are compile-gated only in the sandbox
   ...
```

Mark each with its destination and whether it needs the user's approval.

## Honesty constraints

Inherited from CLAUDE.md and non-negotiable:

- Never record an observation as "fixed" unless the change is in a committed diff and was observed
  working. On-device behaviour needs the device.
- Never invent a pattern from a single occurrence to make the list look fuller. An empty
  observation list is a valid and common result.
- Do not re-litigate a decision the user already made. A decision the user reversed once is a
  preference to record; a decision they reversed after new information is just the work.
