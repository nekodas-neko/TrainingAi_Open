# 2026-09-26 — BF-201 / BF-202: routing owner decisions out of implementer entries

Owner: *"any tasks that need responses make sure they are in the lane of orchestrator or sent to the
backlog agents."*

Audited this session's twelve entries. One genuine gap: **two decisions about the loads he actually
trains at were sitting inside `Lane: A` entries**, where the routing field cannot see them —

- **BF-197** — how much finish-early margin to keep once the 14.2-minute double-count is removed
- **BF-199** — the rep→%1RM table that would replace the model's numbers

Both are scoring calibration, the one category the structural-questions narrowing keeps with the
owner. Split into **BF-201** (`Lane: O`, with an `Ask:` field, ungated) carrying a recommendation,
alternatives and reversal cost for each. **Deliberately no `Needs:`** — BF-197's off-by-one is a
correctness bug that should ship without waiting, and BF-199 wants a plan doc first, so neither lane
is blocked on the answer. Both parents now point at BF-201.

Verified BF-201 and BF-191 both appear under WAITING ON THE OWNER.

**The pattern is wider.** Scanning the whole queue for owner-decision language in a `Lane: A`/`B`
entry with no `Ask:` field returns **70 entries** — filed as **BF-202** for the Orchestrator, whose
stated primary job this is. The number is an upper bound: the scan is a keyword match and cannot tell
*"the owner decided X"* from *"the owner must decide X"*, and separating those is the actual work.
`LA-122` already tracks six of them, so the sweep should reconcile rather than duplicate.

Flagged without acting: **RV-65** is Review's earlier statement of what BF-199 measured, and
RV-200/RV-202 from sweep 61 cover adjacent ground — four entries now describe the same AI-to-logic
change from four angles. Merging them is a queue decision, so BF-202 hands it to the sweep rather
than folding another agent's entry into ours.
