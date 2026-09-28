# 2026-09-28 — Q-524: the user's own step goal is the one number

The owner decided on 2026-08-19 ("we need to use 1 number") and signed off on 2026-08-31 ("manual
wins"). `getDailyGoals` derived 10,000 from the activity level and ignored `users.steps_goal`
(7,000). So the Goals card and the daily digest said a 7,200-step day met the goal, while the
Activity Score and the Activity screen said 72%.

- `GoalProfile.stepsGoal`: when it is set (> 0) it is the goal; otherwise the derived value applies,
  and clearing it is the way back. All four callers pass it: the readiness payload (the Activity
  Score), the day audit, cardio week and health-insight.
- **Moved:** over the owner's last 91 days, the steps contributor rises on 79, by +2.2 points on
  average (median +1.9, max +5.4). That is approximate, assuming all six contributors are present,
  and it applies to scores computed from deploy on. Stored history is unchanged.
- **The provenance column the entry called for is not needed.** The recommend route only suggests,
  and both writers (the sheet and Coach) write only on the owner's accept, which his rule makes
  manual. Recorded on the entry, with the condition under which that stops holding.
- Six mocked-repository tests gained `getUserGoals`. Mutations: ignoring the user goal was caught
  by both new tests, and accepting a zero goal was caught too.
- **Remaining, now `Lane: T`:** deriving the goal from walking energy and measured stride, and
  aligning `DEFAULT_STEP_GOAL`.

A local-environment trap showed up twice today: a suite database carrying another branch's
migration fails tests that have nothing to do with the diff. The rebuild-on-switch rule in
`docs/local-agent-environment.md` (#1850) is what caught it here.
