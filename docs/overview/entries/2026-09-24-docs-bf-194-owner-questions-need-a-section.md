# BF-194 — the owner-question rule failed the same day it was written

**Branch:** `docs/bf-194-owner-questions-need-a-section` · docs-only · BugFix intake

CLAUDE.md gained a rule on 2026-09-24: a question for the owner becomes a `Lane: O` entry and gets
"a queue position near the top". Checked against `main` at `2cda697a`, lane O holds **57 READY
entries and prints 10**, and the three owner questions sit at **15, 16 and 17**.

BF-189 and BF-191 were filed at ranks **1 and 2** the evening before. Fourteen entries went in above
them within about eight hours. No agent did anything wrong — every agent files at the head, because
that is what the convention asks for, so the head is exactly where the churn is.

That makes position the wrong mechanism rather than a mechanism applied badly. Re-ordering buys a
day and asserts this session's priority over four other agents' deliberate ones.

Recommended fix, filed `Lane: O` since the Orchestrator owns the queue: give owner questions their
own section in `next-item.js`, the way `Reference:` already has one at line 290 — printed
unconditionally, outside the `TOP_N` cut. `Reference:` gets that treatment so those entries stay
visible without heading the work list; an owner question wants it for the mirror reason, since it is
not "next", it is blocking.

Three alternatives are recorded with what each is genuinely better at: raising `TOP_N` (trivial, but
a treadmill at 57 entries), a dedicated `Owner:` field (useful if these ever need behaviour beyond
visibility, but a second field is a second thing to get wrong — the `Gate: owner` trap in the same
rule is what that costs), and periodic re-ordering by the Orchestrator (no code, but the manual
version of what a section does for free, and silent when a sweep is skipped).

**Deliberately not done:** the three entries were left at 15–17. The point is to make rank stop
mattering, and promoting my own filings above other agents' would decay anyway.
