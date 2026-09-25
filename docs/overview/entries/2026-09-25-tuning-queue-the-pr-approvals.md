# 2026-09-25 — the owner-question rule does not cover pull requests, and three slipped

Docs-only, one entry. Owner: *"I can answer some of those backlog entries here; but everything should
go to ORC for my review/input."*

## What I checked

All seven decisions I had listed for him are correctly `Lane: O` — verified through `laneFromLines`,
not by eye. They were already with the Orchestrator.

The three **pull requests** I handed him in the same message were not. `grep -cE '#1607|#1592|#1499'`
over the backlog returns **0**. They existed only in GitHub's review-request list and in one chat
message — which is exactly the failure CLAUDE.md's owner-question rule exists to prevent, one category
wider than the rule's wording. #1499 had been waiting since 2026-09-24.

## Filed as TN-80, `Lane: O`, ungated, at the head of the queue

Carries all three with a recommendation each: #1607 (bearer tokens, auth, external — he reads it
himself, no agent merges it), #1592 (active energy — mergeable but revives the input Q-204 removes, and
it invalidates the Q-524 amendment I published yesterday), #1499 (approve; the widening is narrow and
the no-leak behaviour was proven rather than asserted).

The owner list goes 7 → 8 with this at the top.

## The durable half

The rule routing owner questions is written about backlog entries and says nothing about PRs, so a PR
awaiting the owner has no home in the queue. Recommended extension: when a PR needs the owner — auth,
secrets, money, a data-dropping migration, or an external contribution touching any of those — the
opening agent files a `Lane: O` entry with an `Ask:` naming the PR, struck when the PR merges or
closes. Filed as a recommendation rather than edited into CLAUDE.md, since a standing-rule change is
his to accept.

## Not done

**None of the three diffs was reviewed.** This entry routes them; #1607's auth surface in particular
deserves a real read, and a security pass before he reads it would be worth more than my summary. No
claim is made about the two external PRs' CI state, coverage or provenance.

---

## Scope correction — owner, same day

> *"The only questions asked from me in this agent should be about tuning in general for our pillars or
> workouts etc — nothing to do with other avenues."*

Over several turns this session put to the owner: three PR approvals (#1607 auth, #1592 health imports,
#1499 admin scoping), a branch-protection correction, a device-routing sweep, and a proposed change to
the owner-question rule. **Every one was someone else's to raise.**

The findings were sound and the routing was wrong, which is the harder mistake to see — useful work
still spends attention he had not agreed to spend on a Tuning session. Filing them `Lane: O` was
correct; `Lane:` is explicitly the channel between agents. Briefing him on them *here* was not.

Recorded in `docs/agents/state/tuning.md` rather than only here, because a journal entry is read once
and a baton is read at the start of every session of the role. The test it records: if the answer
changes a score, a threshold, a goal or a prescription, ask it in this session; otherwise file it.

The same edit flags the baton stale below "Now" — its header says `Next ID: TN-30` while the real next
free is TN-81, and everything under it predates the TN-55…TN-80 run. A full rewrite is owed.

**TN-80 stands.** The three PRs genuinely were tracked nowhere, and the entry routes them to the
Orchestrator, which is where they should have gone in the first place.

---

## The prediction landed the same day, and my amendment was wrong

TN-80 said of #1592: *"If this merges it has one, and the steps/energy double-count becomes live…
whoever merges it should add that line to Q-204 and Q-524, or my amendment is wrong on `main` with
nothing marking it."*

It merged as **#1616** (*"…, rounded"*, superseding #1592) before the entry reached the owner, and the
line was not added. So the amendment sat wrong on `main`. **Corrected here.**

`app/api/sync-health/route.ts` now accepts `dailyMetrics[].activeCalories` and writes it rounded into
`body_metrics.active_calories` — the column feeding the `activeEnergy` contributor. What survives of
my 2026-09-24 answer: it is still not live *today*, because no client sends the field yet. What does
not: **"probably never" rested on the source being dead, and it is not dead any more.** The collision
now needs only a client, not a decision. The original text is kept rather than deleted, because its
measurements hold and only the forecast failed.

## Two collisions this PR hit, both worth recording

**Another session ran the same journal compaction.** #1617 folded **40** entries into
`history-2026-09-25-folded-1.md`; this branch had folded **12** into a file of the *same name*. Keeping
both would have duplicated entries. Main's landed first and is larger, so this branch's fold was
**dropped entirely** and rebuilt on main — CLAUDE.md's warning that two sessions running the same
chore once cost a whole PR, met in practice.

**A green run is not a mergeable PR.** All ten checks read `success` with `failed_jobs: 0` and the
merge was refused with *"Pull Request has merge conflicts"*. Mergeability has to be read separately;
a green run says nothing about it.
