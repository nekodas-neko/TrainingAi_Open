# 2026-09-01 — every owner gate swept; the queue now holds no unanswered owner question

Branch `docs/owner-decisions-round2`. Docs-only. The owner asked for **every** question or check
needed to unblock the lanes. There were eleven `Gate: owner` entries; two rounds of questions cleared
the lot.

## What came back

| entry | decision |
|---|---|
| **Q-149** | Fit the HRR bar to the user, not a new constant. The owner wears the chest strap while training. |
| **Q-294** | All four undefined failure behaviours decided — two by the owner, two defaulted. |
| **Q-48 / F7** | Keep web-push; build the server-side scheduler. FCM deferred, not rejected. |
| **Q-1b** | Keep deferred — but now with the measurement in front of them, which is what the entry said was missing. |
| **LA-50** | Declined. No GitHub Actions write permission for pixel baselines. |
| **Q-253** | Declined for now. Re-open when `Q-250` ships. |
| **Q-4** | Accepted — one full night wearing the Polar H10. |

`Q-11` (the per-set HR backfill) and `Q-71` (the historical redecode) were offered and not taken.
That is a scheduling answer, not a refusal; both are annotated so the next session folds them into a
batch rather than asking again.

## The finding: Q-149's entry was wrong about its own data

The entry argued that a measured HRR bar was unusable because the ring power-gates when idle, giving
only ~7 verdicts. Re-measured against `claude_ro.set_hr_stats` on 2026-09-01, both halves fail:

- **The chest strap is the dominant source and has been since 2026-08-05** — `chest_strap` **156**
  rows against `ble` **39**, with `coverage_ok` on **137 of 156 (88%)** against **21 of 39 (54%)**.
  The owner's own statement matched the data; the entry did not.
- **"~7 verdicts" was a stale figure from 2026-08-08.** There are **84** strap rows carrying
  `drop_60s`.

And the number that explains the whole question:

| strap rows with `drop_60s`, n = 84 | |
|---|---|
| median | **8 bpm** · p25 2 · p75 14 · p10 **−1** |
| reach the 15 bpm bar | **20 of 84 — 24%** |
| mean peak · trough | **99** · 79 bpm |

**The textbook bar fails 76% of this owner's sets**, and the last row says why: at a mean peak of
99 bpm, 15 bpm is a ~15% drawdown, where the textbook number assumes peaks of 150–180. The bar was
never wrong in the abstract — it was calibrated for different physiology. That is what makes "fit it
to me" the right answer rather than "pick a smaller integer".

Q-149 is **re-gated on signing the fitted number**, which is a different gate from the one cleared:
Tuning proposes, the owner signs, Lane A implements, because this re-scores months of history.

## Two gates that were never the owner's

- **Q-48** lost its gate without an owner answer. F1, F2, F3 and F7 are all answered and F8 was fixed
  in its own PR; what remains is **planning work** — a table-residency matrix and a parity harness —
  which had been invisible behind a decision field for weeks.
- **Q-294** likewise: the decision *was* the work, and with all four cells decided it becomes a
  `Reference:` for Q-249's E2E scenarios rather than an item of its own.

## Where the gates went

**11 → 7, and none of the 7 is an open question.** Two are decisions already made (`Q-1b`, `Q-149`),
two are actions deferred to a later batch (`Q-11`, `Q-71`), one is an accepted action (`Q-4`), one
the owner explicitly held (`Q-551` — do not re-ask until Q-545 ships), and one is a stop sign whose
own text forbids asking (`TN-16`).

## Not done

Nothing was built or verified on a device. `Q-4`'s night has not happened yet — when it does, the
check is one query, and it is written into the entry so nobody has to reconstruct it.
