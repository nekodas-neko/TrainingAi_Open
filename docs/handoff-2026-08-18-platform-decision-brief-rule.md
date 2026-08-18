# Handoff — 2026-08-18 — the decision-brief rule, and what merging it cost

**Domain:** `platform` · **Session type:** owner-directed, one-off (not one of the five standing agents)
**Branch:** `claude/decision-making-context-rule-v7plwu` · **PRs:** #69 (merged), #76

## What the session was for

The owner was re-typing the same two follow-ups nearly every time a session stopped on a decision:

> "give me all the recommended options with your recommendation and why, and the alternative options
> and why" … then "give me the options that are best practice for this type of architecture and
> future proof as we want the best longterm option rather than quick fixes — also explain in simple
> plain English words."

Both correct the same failure — a session hands back a bare question, and the owner pays a round trip
to get the answer into a usable shape. The ask was to condense it into a standing rule.

## What shipped

**#69 (merged, `5a4023b`)** — one section in `CLAUDE.md`, **"Decisions That Come Back To Me — answer
the whole question the first time"**, above **Communication**, plus a Standing Instructions pointer.

Two halves. The first was not asked for and matters more:

- **Don't ask at all** unless the decision is hard to reverse (migration, auth, external contract,
  public surface), expensive to reverse (it seeds a pattern the codebase copies), or a genuine
  preference not derivable from the repo. Everything else the session decides, states in one line,
  and continues.
- **When it is the owner's:** recommendation in the first line · why, framed a year out · alternatives
  with what each is genuinely *better* at · reversal cost · plain English.

Guardrails, so it does not become ceremony: a ~15-line cap, **no manufactured trade-offs**, and a
`quick fix` / `temporary` / `spike` override that flips the bias to speed with the debt named.

**#76 (open at time of writing)** — the journal entry #69 should have carried, the **Q-543** backlog
entry below, and the baseline raises both required.

## Decisions made, so they are not re-litigated

- **Trimmed the section rather than only raising the baseline around it.** The doc-index ratchet
  failed at 1059 vs a 1010 baseline. The check offers both exits; took both — cut 49 lines to 34,
  then raised. A rule whose own guidance is "keep it under a minute's reading" arriving in 49 verbose
  lines argues against itself, so this was substantive, not CI-appeasement.
- **Put the "don't ask at all" threshold first.** The owner asked for a better *format*. Most of what
  currently reaches them does not need to reach them at all, so volume reduction should outweigh
  formatting. **This is the part most likely to be drawn in the wrong place** — it is the line to move
  if the rule misbehaves.
- **Q-543 filed, not taken.** Restructuring a CI gate mid-merge is not a docs change.

## The gotcha worth carrying forward

**The doc-index BASELINE object is now the repo's most reliable merge conflict.** #69 took four CI
rounds: one genuine ratchet failure, and **three base collisions — with #68, then #65/#71, then #75 —
every one on `scripts/check-doc-index-size.js`, none on the content being changed.** Filing Q-543
then hit the same conflict a fourth time, on the entry describing it.

Resolve these by **rebuilding the file from `origin/main` and re-applying your one row**, never by
splicing the conflict hunk — that file's own comments warn in five places that splicing silently
un-does the other lane's raise, and record a near-miss where it nearly did.

`merge_pull_request` refusing with *"Pull Request has merge conflicts"* is the reliable signal here;
`get_check_runs` returning `total_count: 0` was the earlier tell for the same stale base.

## A stale finding, reported and retracted

Mid-session I flagged a duplicate `'projectOverview.md'` key in the BASELINE object. It was real at
`da8712b` — genuinely last-wins — but **#71 removed it before I reported it.** Accurate when observed,
wrong when delivered. On a file moving this fast, re-check at delivery, not only at read.

## Deliberately NOT done

- **Q-543 itself** — the baseline-fragment restructure. Filed with two candidate shapes and one
  explicit warning (do not solve it by deleting the raise-history prose).
- **The `docs/overview/entries/` compaction sweep.** The directory holds ~48 files against a ~20-file
  chore threshold. The check reports it as a note, not a failure. Out of scope for an owner-directed
  docs session and large enough to deserve its own.
- **No version or changelog bump.** Nothing user-visible.

## What was NOT exercised

- **Nothing runtime.** Docs-only across both PRs — no route, component, schema, native code or APK
  implication. No `pnpm dev` pass and no device run, because there is no behaviour to observe.
- **The rule is unverifiable by construction.** No CI check can tell a well-shaped decision brief from
  a bare question. Whether it reduces round trips is observable only across later sessions.
- Verification was `pnpm check:rules` — **38 of 38** — plus full CI green on #69's final head.

## Blocked on the owner

Nothing blocking. One open question worth an opinion when convenient: whether the "don't ask at all"
threshold is drawn correctly. If sessions start deciding things the owner wanted to be asked about,
that paragraph is the one to tighten — not the five-part format below it.

## Pickup prompt

> You are picking up an owner-directed session in the TrainingAI repo. Start on `main` (fresh:
> `git fetch origin main && git remote prune origin && git checkout -B <your-branch> origin/main`).
>
> Read in this order: `projectOverview.md` → `docs/domains/platform/README.md` →
> `docs/handoff-2026-08-18-platform-decision-brief-rule.md` (this doc).
>
> Context: a standing rule shipped in #69 governing how decisions are brought to the owner —
> recommendation first, alternatives with what each is better at, reversal cost, plain English, and a
> threshold that keeps cheap reversible choices from reaching them at all. It is in `CLAUDE.md` above
> **Communication**. It binds you.
>
> If you are looking for the next concrete action, **Q-543** in `docs/implementation-backlog.md` is
> the one this session filed and did not take: the doc-index BASELINE object in
> `scripts/check-doc-index-size.js` is the repo's most reliable merge conflict (three of four CI
> rounds on #69 were base collisions on it, none on the content being changed). The entry carries two
> candidate shapes; picking between them is a judgement call, so bring it as a decision brief in the
> shape the new rule describes rather than implementing blind.
>
> Constraints you would otherwise rediscover: everything reaches `main` through a PR with all five
> required checks green (Lint, Tests, Build, Custom Rules, Migration Check — E2E is not required);
> `pnpm check:rules` is the local custom-rules gate and prints how many steps it ran, so quote the
> count; concurrent lanes move `main` under you constantly, so re-merge `origin/main` immediately
> before opening each PR *and* again before merging; and resolve any
> `scripts/check-doc-index-size.js` conflict by rebuilding from `origin/main` and re-applying your one
> row, never by splicing the hunk.
