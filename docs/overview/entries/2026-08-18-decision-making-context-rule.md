# 2026-08-18 — A standing shape for decisions that come back to the owner

**Branch:** `claude/decision-making-context-rule-v7plwu` · **PR:** #69 · **Type:** docs / standing rule

## What prompted it

The owner was typing the same two follow-ups nearly every time a session stopped on a decision:

> "give me all the recommended options with your recommendation and why, and the alternative options
> and why" … then "give me the options that are best practice for this type of architecture and
> future proof as we want the best longterm option rather than quick fixes — also explain in simple
> plain English words."

Both are corrections to the *same* failure: a session hands back a bare question, and the owner pays
a round trip to get the answer into a usable shape. Asked to condense it into a rule so the prompts
stop being necessary.

## What shipped

One section in `CLAUDE.md`, **"Decisions That Come Back To Me — answer the whole question the first
time"**, placed above **Communication**, plus a pointer bullet in Standing Instructions.

It has two halves, and the first is the one that matters more than the requested format:

**Don't ask at all** unless the decision is hard to reverse (migration, auth, external contract,
public surface), expensive to reverse (it seeds a pattern the codebase copies), or a genuine
preference not derivable from the repo. Naming, file layout, which primitive to reuse, two
equivalent implementations — the session decides, states the pick in one line, continues. Most of
what currently reaches the owner is this category, so the volume reduction should matter more than
the formatting improvement.

**When it genuinely is the owner's,** the brief carries: the recommendation in the first line (one
named option, not a menu) · why, framed a year out rather than this afternoon, defaulting to the
durable option and naming the debt when recommending the quick one · alternatives, each with what it
would genuinely be *better* at · reversal cost · plain English.

Three guardrails added beyond what was asked, so the rule does not become ceremony: a ~15-line cap
(a brief longer than the work has failed), **no manufactured trade-offs** (one sane option means say
so and proceed — inventing a runner-up to fill the template is the same failure as the bare
question, from the other side), and an override where "quick fix" / "temporary" / "spike" flips the
bias to speed with the durable version noted in one line.

## The ratchet caught it, correctly

`check-doc-index-size.js` failed the Custom Rules job: the section put `CLAUDE.md` at 1059 against a
1010 baseline. The check offers two exits — move the material, or raise the baseline in the same PR
if the growth belongs in the index. Took both: cut the section from 49 lines to 34, then raised the
baseline for the remainder. A rule whose own guidance is "keep it under a minute's reading" arriving
in 49 verbose lines argues against itself, so the trim was not merely appeasing CI.

## Four CI rounds, three of them base collisions

Recorded because the frequency is the finding, not the individual conflicts. `main` moved under this
branch three separate times during one merge attempt — #68, then #65 and #71, then #75 — and every
one collided on `check-doc-index-size.js`, because concurrent lanes all raise their baselines in the
same object literal on the same day. `merge_pull_request` refused once with a genuine conflict,
which is the documented reliable signal.

Each resolution rebuilt the file from `origin/main` and re-applied the single `CLAUDE.md` row rather
than splicing the conflict hunk — the failure mode that file's own comments keep warning about,
where splicing silently un-does the other lane's raise.

**Left alone deliberately:** the BASELINE block is now ~170 lines of raise-history commentary above
three numbers, and every concurrent PR conflicts on it. That is a real friction source and a
candidate for per-file baseline fragments, but restructuring a CI gate mid-merge is not a docs
change and was out of scope here. Not filed as a backlog entry — it is an observation about
contention rather than a defect, and the compaction sweep may be the better place for it.

## A stale finding I reported and then retracted

Mid-session I flagged a duplicate `'projectOverview.md'` key in the BASELINE object — a real
last-wins duplicate, present at `da8712b`. By the time it was reported it was already gone: #71 had
removed it. The report was accurate when observed and wrong when delivered, which is the hazard of
reading a fast-moving file and reporting from the read rather than re-checking at delivery.

## What was NOT exercised

- **Nothing runtime.** Docs-only; no route, component or schema touched, so no `pnpm dev` pass, no
  device run, and no APK implication. The changed file is instruction text.
- **The rule itself is unverified by construction.** Whether it actually reduces round trips is
  observable only over subsequent sessions, and the "don't ask at all" threshold is the part most
  likely to be drawn in the wrong place. No mechanism enforces it — no CI check can tell a
  well-shaped decision brief from a bare question.
- **No version or changelog bump** — nothing user-visible.
