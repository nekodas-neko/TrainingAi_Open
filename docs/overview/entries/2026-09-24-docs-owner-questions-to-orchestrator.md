# A question for the owner is a task, not a chat message

**Branch:** `docs/owner-questions-to-orchestrator` · docs-only

Owner, 2026-09-24: *"Questions that I need to answer should be assigned a task and sent to
Orchestrator to be completed there."*

The channel already existed — `Lane: O` — and the failure was in how it was being used, not in the
mechanism. Three things came out of checking rather than assuming:

**The obvious encoding is the wrong one.** `Gate: owner` reads like the right field and inverts the
instruction: `Gate:` parks an entry in `next-item.js`, so a question gated on the owner drops out of
the Orchestrator's READY list and nobody is tasked with putting it to him. Getting the answer is
itself the work, so it is `Lane: O`, ungated. The rule now says this outright.

**Filed entries were reaching the queue, contrary to a first reading.** BF-188 and BF-189 parse
correctly as `Lane: O` and sit at ranks 15 and 16 of 29 READY — below `TOP_N = 10`, which prints
only the top ten per lane. They were never invisible, and the rule now notes that an owner question
filed at rank 15 is in the queue and in nobody's view, so it belongs near the top.

**Two entries were genuinely mis-routed, and both were mine.**

- **BF-107** was `Lane: B` and was reported back to the owner as *"your five-second check"*. The
  next action — open the walk, does the calories tile fill — is a measurement with an objective
  pass/fail, which §3 assigns to the device agent, not a judgement waiting on him. Re-laned `DV`,
  with the three answers it may return and where each one sends the entry next.
- **BF-190** was `Lane: B` and carried two owner decisions in its body, where the lane field routed
  them to an implementer. Split into **BF-191** (`Lane: O`): whether a sub-minute walk should be
  saved at all once the duration is truthful, and what happens to the phantom row already in the
  history. BF-190 keeps the half that needs no decision and does not wait.

BF-191 carries a caveat worth keeping: only 2026-09-24 was checked for phantom rows. The signature
to sweep for is a row whose `duration_min` equals the plan while `avg_hr` and `steps` are both null.
No count is claimed until that runs.
