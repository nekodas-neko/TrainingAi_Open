# 2026-08-24 — the breathing baseline is fine; the same scale trap caught both agents in one day

*Tuning · docs-only · branch `docs/clear-bf13-gate`*

BF-14 reported the breathing-rate baseline converging to ~93 against a real 9.8 rpm — a units
mismatch of about 9.5×, and explicitly *"rules out BF-13's zero-seed as the cause"*. **Refuted.**

The ×10 is deliberate and documented at the feed site. `daily-summary.ts:110-112` reads *"Breathing
in rpm×10 for integer-sample resolution (same trick as MET ×10)"*, and `personal-baseline.ts:32`
stores `sample << 3`. So the column is `(rpm × 10) << 3` and **rpm = meanX8 / 80**, not `/8`.
Corrected, the newest baseline is **9.250 rpm** against a true mean of **9.400** (sd 0.553) — a gap
of **+0.27 sd**, clean.

Its own table is evidence *for* BF-13 rather than against it: the ratio of `raw/8` to rpm climbs
8.89 → 9.44 **toward 10**, which is the ×10 feed with the zero-seed lag still closing. The residual
0.15 rpm is what remains of that lag, and BF-13's seed fix covers it because that fix applies to all
six baselines.

**The same trap caught both agents on the same day, in opposite directions.** BugFix divided by 8
alone and saw a defect that is not there. Tuning inferred sleep's factor as the best-fitting power of
ten when it is ×60, and produced a phantom 3.24-hour sleep defect that would have caused an
unnecessary production data change. **Read the factor at the call site; never infer it, and never
assume an `X8` suffix names the whole scale.** All six sit within four lines of each other.

Entry kept rather than deleted, with the reasoning, per Q-504's precedent — a refutation that is not
written down gets re-filed.

**Not exercised:** no code ran — SQL against production plus source reading.
