# 2026-09-27 — the twelve buried questions, answered; and the check-in turns out to be 10% of readiness

**Branch:** `request/owner-answers-round-2` · Orchestrator

`BF-202`'s second pass gave thirteen buried decisions an `Ask:` field. Twelve were put to the owner
in three rounds; the thirteenth was withdrawn as not his. `Ask: owner` is **28 → 17**.

## Answered

| Entry | Answer |
|---|---|
| `BF-144` + `LA-71` + `LB-42` | **Approve the `destructive-migration` group** — snapshot first, three separate PRs |
| `Q-540` | **Drop `event_name`**, with the dead-object evidence shown |
| `Q-251` | **Not yet** — revisit after `OR-195`; deferred, not refused |
| `Q-297` | **E2E stays advisory.** Revisit only with a measured pass rate |
| `TN-72` (+`TN-74`) | **Re-derive the 84 days** via a bounded admin re-derive |
| `PS-51` | **Take the proposed mapping** — forest/house/castle off three different ladders |
| `BF-96` (+`BF-139`) | **Abbreviate the date** to `Wed 30 Sep`; temperature and UV both stay |
| `BF-145` | **Wallpaper tint stays opt-in** |
| `LA-89` | **Delete `oura/hr-sync`** once proved dead |
| `BF-168` | ***Start Again* was not pressed** — stale state, the entry's assumption confirmed |
| `TN-67` | **Do not hide the score** — and the rating must stop feeding it |
| `RV-166` | **Combine walk and run in the cardio hub**; either completes the prescription |

## Two answers that were bigger than the question

**`TN-67`.** He was asked whether to hide the readiness score until the check-in is saved. He said
no — *"we hit this issue before where nothing was usable till after my checkin; I dont like that"* —
and added the instruction the question had not asked for: *"I dont want the rated score by me to
affect the score derived for the day. It should be used to post tuning only."*

**That is not what the code does.** `readiness-composite.ts:30` sets `checkin: 0.10` — his
self-report is **10% of the readiness score** on every day he answers, via `checkinScoreFromEnergy`.
Filed as **`OR-200`**, `Lane: T`, because dropping a contributor re-weights the other nine and
re-scores history on every day he checked in. The proposal must state how many days move before
anyone builds it.

It also does not make the rating a clean validation target: he still sees the score before rating
and has refused hiding it, so the anchoring is **halved, not removed**. The 2026-10-20
re-measurement must be reported with that caveat rather than as a clean correlation.

**`RV-166`.** Asked whether a walk counts as doing a prescribed run, he answered with a design
instruction: *"the walk/run section should be combined in the cardio hub; and would require one or
the other to be done."* That dissolves the finding rather than ruling on it — but it is an
information-architecture change to a daily screen, so it **owes a mockup first**. That makes four
mockups for one sitting: `LA-136`, `LB-163`, `RV-213`, `RV-166`.

## One question withdrawn as not his

`LB-38` asked the owner to choose the barcode scanner. **Decided here instead: keep
`@zxing/browser`.** Which library decodes a barcode is tooling, which the 2026-09-22 narrowing puts
on the agent. It works, and the entry names no defect a swap would fix. What would reopen it is a
measured decode-failure rate, which nobody has taken.

## Conditions attached to the three approvals

All carry the owner's 2026-09-27 production policy: a **verified snapshot — taken *and* restored** —
before the run, and the affected-row count printed against prediction, **stopping on a mismatch**.
The schema group ships as **three separate PRs**, never batched, because a migration's revert is a
corrective migration. Each needs its number from `node scripts/next-schema-number.js`, not
`ls | tail -1` — `#1608` is holding 288/289 against `main`'s own right now.

**Not exercised:** documentation only. Gates: `Ran 83 of 83` Custom Rules, `check-doc-links`,
`check-backlog-pointers` — clean by exit code.
