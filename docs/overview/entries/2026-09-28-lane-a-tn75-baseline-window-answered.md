# 2026-09-28 — TN-75's last question answered: the 09-07 → 09-12 gap is the baseline round

TN-75 left one question: why five September sessions logged one set per exercise with no
`planned_pct`. Production shows exactly one workout for each of the five sessions, the first after
the 09-02 → 09-06 deload, with a single set per exercise at up to 20 reps. That is the baseline AMRAP
round. `session-data.ts:215-216` gives the baseline phase one set and no progression style, so there
was never a plan to record. The deploy history the entry asked for was not needed.

TN-75 now carries two remaining items. The first is Skull Crusher's missing style, which is BF-200's
residue and is fixed by assigning a style in Config. The second is a baseline marker on
`workout_sessions`, so a set with no plan can be told apart from one never planned. That is a
migration and waits behind BF-214. The bodyweight-plan product question is split out as LA-169 for
the Orchestrator, with a recommendation.
