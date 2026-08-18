# 2026-08-18 — Review sweep 34: Q-499 reproduced, and a Q-number ledger near-miss

**Agent:** Review 📖 · **Branch:** `review/q-band-and-429-probe` · **Docs-only.** Confirmed **Q-499**; filed **Q-552**.

Sweep 33 named its own next step and did not take it — *drive a card to a 429 in a browser and watch
it vanish*. This sweep took it.

**Q-499 is confirmed.** Forcing `/api/weights-summary` to 429 by Playwright route interception at the
S25 viewport, authenticated as the seeded user: `Estimated 1RM` went from **1 node at baseline to 0
under the 429**, with **no error wording anywhere on the page**. The control holds — in a third run
that blocked a *different* endpoint, the card was back at 1, so the disappearance is caused by
blocking that card's own endpoint rather than by the interception harness. `Ring Status` is
**inconclusive**, not clean: the seeded account has no ring data, so it is absent either way.

**It took four runs, and the three failures were mine, not the app's.** A warm-cache run showed the
card surviving on a seeded stale value, which I briefly took as refuting my own finding — it was the
cache masking it. A cold-cache run used a card that is absent at baseline anyway. And a third fired
90 requests to trip `/api/weights-summary`'s rate limiter, which **does not have one** — all 90
returned 200, so the "under-429" run was never under a 429, and the result table still printed a tidy
`baseline=1 under429=1`. Only the `TRIP 0 of 90 were 429` line showed the independent variable had
never been applied. That one would have produced the right general conclusion at the time through a
measurement that established nothing.

**A nuance the reproduction added.** The vanish is invisible on a repeat visit with a warm seed and
appears on a cold one. So the user most likely to hit it is opening the app fresh, and the person
least likely to reproduce it is the same person a minute later. That makes *"the card is gone"* look
**intermittent**, which invites exactly the "can't reproduce" dismissal `CLAUDE.md`'s
report-invalidation rule exists to prevent. The reproduction spec is in the review doc rather than
committed as a test — it asserts the correct behaviour and is red today, so it belongs in the fix PR.

**Q-552 — two sources of truth, and the prose one was wrong.** Review's band 450–499 was exhausted
by Q-499. `docs/agents/README.md` says *"claim the next block of 50 above 529"*, which literally gives
530–579 and collides with **fourteen numbers already in use** — and the predecessor baton had already
written 530–579 into the handover. The ledger listed 530–537, 538–542 and 543; **544–551 were also
live** across two platform handoffs, the 2026-08-15 history, the devices domain index and the backlog,
and appeared nowhere in it.

**But the first draft of this entry was wrong about why, and the correction is the useful part.** I
wrote that the ledger is "the only defence against collisions". It is not — there are **two** sources
for the same fact. The backlog's *Live pointers* row said **552**, was correct all along, and is
**CI-enforced** by `scripts/check-backlog-pointers.js`. The README's prose ledger and its "next block
of 50 above 529" said **530** and was stale. **The machine-checked pointer was right the whole time,
and the collision was reachable only by following the prose instruction** — which is what the README
tells you to do, and what this role's baton had already copied.

The check also earns its keep: claiming 552 without updating the band table **failed Custom Rules in
this very PR** — *"Q-552 is in use but the next unallocated band starts at 552 — a band was used
without being recorded."* So this is the third confirmed instance of Q-492's thesis, and the first
where the checked copy was silently right while the prose copy was silently wrong. Fixed here:
claimed **552–601**, recorded 544–551, bumped the pointer to **602**, and pointed the instruction at
the checked source rather than the prose list.

**Not exercised:** web build at the S25 viewport against the seeded database. Not on device, and not
offline — where `cachedFetch` cannot revalidate at all and the failure should be more common, not
less. One card proven; the other eleven remain a worklist.
