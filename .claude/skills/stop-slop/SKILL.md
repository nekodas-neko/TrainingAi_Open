---
name: stop-slop
description: Strip AI writing tells out of prose — filler openers, binary contrasts, passive voice, vague declaratives, adverb padding. Use when writing or editing any prose this repo ships: handoff docs, journal entries, projectOverview updates, PR bodies, commit messages, changelog entries, and user-facing UI copy. Also use when the user says "stop slop", "de-slop this", "this reads like AI", or "make this sound human".
version: 1.0.0
---

# Stop Slop

Adapted from [hardikpandya/stop-slop](https://github.com/hardikpandya/stop-slop) (MIT), scoped to
the prose surfaces this repo actually ships.

The failure mode: an agent writes a handoff doc or PR body in generic LLM register — throat-clearing
openers, three-item lists, "not just X, but Y" contrasts, confident vagueness — and the next session
has to re-read it twice to extract one fact. Slop is not just an aesthetic problem here. **It is a
comprehension cost paid by the next agent**, who starts cold and has only the docs.

## Where this applies

| Surface | Why it matters |
|---|---|
| `docs/handoff-*.md` | Read cold by the next session. Vagueness here is re-discovery cost. |
| `docs/overview/entries/*.md` | The permanent record of what a session did. |
| `projectOverview.md` Known Issues / Risks | A vague issue row is an unactionable issue row. |
| PR titles and bodies | Reviewed by a human; also the squash-commit message. |
| Commit messages | CLAUDE.md: must read as written by a human engineer. |
| `lib/changelog.ts` entries | User-facing. |
| UI copy (labels, empty states, toasts, errors) | User-facing, and space is tight on a 6.9" screen. |

## Core rules

1. **Cut filler.** No throat-clearing openers, no emphasis crutches, no adverbs. See
   [references/phrases.md](references/phrases.md).

2. **Break formulaic structures.** No binary contrasts, negative listings, rhetorical setups, or
   dramatic one-line fragments. See [references/structures.md](references/structures.md).

3. **Active voice with a real subject.** Someone did something. Not "the cache was invalidated" —
   *"`invalidateWorkoutSummaries()` clears it"*. Never let an inanimate thing perform a human verb
   ("the bug reveals", "the decision emerges", "this change unlocks").

4. **Be specific, and prefer the identifier.** "The sync path had an issue" is slop. *"`pushMutations`
   dropped the whole batch on one 400"* is not. In this repo, specificity usually means naming the
   file, function, migration number, PR number, or table.

5. **Vary rhythm.** Mix sentence lengths. Two items beat three. Do not end every paragraph with a
   punchy fragment.

6. **Trust the reader.** They are an engineer or an agent with the repo open. Skip the softening,
   the justification, and the recap of what you just said.

7. **Cut quotables.** If a line sounds like it wants to be a pull-quote, rewrite it as a fact.

8. **No emoji in prose or UI.** CLAUDE.md already mandates Lucide icons over emoji in the app. The
   ✅ / ⚠️ status marks in `projectOverview.md` are a deliberate exception — they are structured
   status, not decoration.

## Repo-specific deviations from upstream

- **Em dashes are allowed in `docs/` and `CLAUDE.md`.** Upstream bans them outright. This repo's
  entire doc corpus uses them as deliberate house style, and a rule that contradicts thousands of
  existing lines will simply be ignored. **Keep them out of UI copy and changelog entries**, where
  they cost horizontal space on a 6.9" screen and read as AI register to an end user.
- **Passive voice is acceptable in migration and schema notes** where the actor is the database and
  naming it adds nothing ("the column is backfilled on first read").
- **Honesty rules outrank style rules.** CLAUDE.md forbids writing "fixed" for anything not in a
  committed diff and observed working. If de-slopping a sentence would make an unverified claim
  sound more confident, keep the hedge and cut elsewhere. Tighten the prose, never the truth.

## Quick pass before delivering

Run this list over anything above ~3 sentences:

- Adverbs? Cut them.
- Passive voice with a hideable actor? Name the actor.
- Inanimate subject doing a human verb? Rewrite around the person or the function.
- Opens with "Here's what/this/that", "Let's", "In this section"? Cut to the first real claim.
- "Not X, it's Y"? State Y.
- "It's worth noting", "It's important to", "Simply", "Essentially"? Delete the phrase; the sentence survives.
- Three sentences in a row the same length? Break one.
- Vague declarative ("the implications are significant", "this improves reliability")? Name the specific thing.
- A claim of "done" or "fixed" without a committed diff behind it? That is a CLAUDE.md violation, not a style problem — fix the claim.
- A noun that could be a file path, function name, table, or PR number? Use it.

## Scoring

When asked to review rather than rewrite, rate each dimension 1–10:

| Dimension | Question |
|---|---|
| Directness | Does it state, or announce that it is about to state? |
| Specificity | Are the nouns real — files, functions, numbers? |
| Rhythm | Varied, or metronomic? |
| Trust | Does it respect an engineer reader? |
| Density | Is anything cuttable without losing information? |

Below 35/50, revise before delivering.

## What this skill does not do

It does not change technical content, soften a risk, or shorten a doc past the point where the next
session loses context. A handoff doc is allowed to be long. It is not allowed to be padded.
