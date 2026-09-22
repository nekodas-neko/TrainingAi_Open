# 2026-09-22 — `chore/or-125-owner-decisions` (OR-125)

**Orchestrator.** The owner answered six questions in one sitting. This records them where the work
is, and closes five dead PRs.

## The six

| # | question | answer |
|---|---|---|
| 1 | Five PRs open with nothing live in them | **Close all five** — #1250, #608, #265, #10, #6 |
| 2 | Q-28 / BF-9 / BF-7, held by a prompt not a field | **Release all three** |
| 3 | LA-121 — port the temperature ladder, or let `tempZ` stand? | **`tempZ` stands; delete the ladder** |
| 4 | Q-29 Task 5 — drop the server raw archive? | **Show the case first** |
| 5 | The `.size` conflict tax | **A filing sweep ships as ONE PR** |
| 6 | BF-111's failing About card | **Owner will send a screenshot** |

## What each one changed

**The five PRs are closed.** #1341 had merged on its own since LA-122 listed it. Three remain open
and all three are live. LA-122 item 6's own point stands and is why it was written down: CLAUDE.md
exempts pushing, opening and merging-when-green from confirm-first and deliberately does not exempt
**closing** — so an agent that proves a PR dead still cannot clear it. That is correct, and it is
also how six accumulated. The fix is a list an owner will actually see.

**Q-28, BF-9 and BF-7 are released**, recorded on each entry. The Lane A scheduled prompt's
exclusion list should stop naming them. The owner took the item's own argument: a rule living in a
prompt rather than in the file every agent reads goes stale unnoticed.

**LA-121's gate is released and the answer is recorded on the entry** — `computeBlendedScore` goes
with the four dead arms. Two constraints carried forward: the **fifth** site (`:628`) is a live gate
with a dead disjunct and needs separate treatment, and `temp-penalty-suspension.test.ts` is **not**
deleted with the ladder, because it is the only record of what the ladder did and "superseded" is a
decision that can be revisited where a destroyed record cannot.

**Q-29's ball came back to us**, which is the right outcome. Declining to answer a one-line summary
of an irreversible change is not indecision. `OR-126` is filed for the brief: what is dropped, what
survives in the device's deliberate 14-day window, what becomes permanently unrecoverable (the
history buffer only moves forward, so a later decoder fix can back-fill only from stored hex), and
what keeping it actually costs — measured, against a ~227 MB database billed at $0.15/GB/month.
The entry carries an instruction not to write it as an argument for the drop.

**CLAUDE.md gains one rule:** a filing sweep ships as one PR. Review sweep 53 was twenty entries;
as twenty PRs that is nineteen guaranteed conflicts on a single line of one `.size` file. Also
recorded there: `enable_pr_auto_merge` does not work on this repo, so the CI/CD section's
auto-merge escape is unavailable and every merge is hand-driven against a moving base. The better
long-term fix — generating the baselines in CI — was named and is unfiled.

## Worth carrying

**Four of the six had sat between one and nine days. A fifth had been noticed in an earlier
session, recorded nowhere, and re-derived from scratch.** None was a hard question. They were
questions nobody had been asked, because each lived in a session transcript that ended. Writing
them into one entry an owner could read was the whole of the work; the answers took one sitting.

The same day produced the exact inverse. **`LB-121` is now the third independent filing of the ⛔
parser bug** — after `LA-49` (2026-09-01) and alongside `TN-59` and `OR-122`, four sessions across
three weeks, no two aware of each other. LA-49 had the complete diagnosis and a two-step fix on day
one and never surfaced, because it quotes the glyph as evidence and was parked by the bug it
describes. It is rewritten here as a `Reference:` on that pattern rather than deleted.

**A finding that reaches a human gets answered. A finding that hides itself gets re-derived, and
each re-derivation pays the investigation again.**

## Not done

- **OR-126 is not written** — that brief is the next Orchestrator task, and Q-29 stays gated until
  it exists. Do not re-ask the owner before then; asking twice for the same yes with no new
  evidence gets a decision made on fatigue.
- **BF-111 stays `Gate: owner`** until the screenshot arrives.
- **Generating `.size` baselines in CI** is named in LA-122 item 5 and has no entry. It removes the
  conflict class rather than reducing it, but it is a real change to the ratchet.
- **The Lane A prompt still names Q-28/BF-9/BF-7** in its exclusion list — that is outside the repo
  and cannot be edited from here.
