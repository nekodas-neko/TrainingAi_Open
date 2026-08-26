# 2026-08-26 — what the HR tile should show, and whether a paced Activity score works (TN-17, TN-13 amended)

**Tuning · docs-only.** Four owner follow-ups to the pillar review. Two were measurable and got
measured; one was a reconciliation; one is agreement.
Full working: [`docs/reviews/2026-08-26-hr-tile-and-activity-pacing.md`](../../reviews/2026-08-26-hr-tile-and-activity-pacing.md).

## The HR tile — the metric was never the lever

The owner offered two alternatives (average awake resting HR, or a resting-HR comparison) and asked
what could actually be used. Both were tested against `perceived_recovery`:

| | r | n |
|---|---|---|
| waking-rest HR, raw bpm | +0.176 | 51 |
| nightly resting HR, raw bpm | +0.129 | 46 |
| waking-rest HR, **Δ vs baseline** | **+0.291** | 51 |
| nightly resting HR, **Δ vs baseline** | **+0.278** | 43 |

**Baseline-relative roughly doubles either candidate; choosing between them barely moves anything.**
So the defect is showing an absolute bpm at all — 69 means nothing without knowing your usual is 63.
TN-13's recommendation is unchanged and now has a measured reason instead of an assumed one.

**A reconciliation the entry needed.** The pillar review's headline **+0.557** and this **+0.129** are
the same signal measured two ways: the stored `readiness_contributors.restingHeartRate` score against
`perceived_recovery` is **−0.553 (n = 35)**, the sign carried by two scales running opposite ways
(`perceived_recovery` is 1 = fully recovered … 5 = wrecked). **Dropping the 4 `provisional: true`
days — score pinned at the placeholder 50 — is what takes it from −0.395 to −0.553.**

The owner's waking-rest HR is a genuine signal (70 days, 984 samples/day, moving 6.24 bpm/night
against the tile's 0.44) and the better **stress** candidate. It stays out of TN-13 because nothing
in the app computes it — it was derived in SQL for this review.

## Activity pacing — TN-17, and the goals are the problem

The owner's design works mechanically: `body_metrics.steps` is a running daily total, so "steps so
far" is answerable at any hour. **`step_live_windows`, the obvious source, is effectively empty** —
8 rows across 6 days — and would read a flat zero.

**What the measurement adds is the caution.** Median day 4,649 steps; 7,000 reached on **32%** of
days, 10,000 on **15%**. A paced score goes red from mid-morning on most days, where today's lenient
average reads 63–82. **Pacing does not create that — it stops the averaging from hiding it**, which
makes goal calibration (Q-524, three live step goals) load-bearing rather than tidy-up.

## TN-3a shipped and its entry had not noticed

`oura_daytime_stress_buckets` is live (migrations 212/213), **69 rows across three days, ~26
buckets/day**. The back-fill has not happened, so the entry stays queued with a `Keep:` naming it
rather than being struck. **This does not unblock TN-3b** — that and TN-16 are parked on Q-507's
sign, unchanged.

## Verification

`pnpm check:rules` — **Ran 58 of 58 Custom Rules steps, all passed.** `check-backlog-pointers` OK.
**Failure surfaces not exercised: all of them.** No code ran — SQL against production plus source
reading; no `pnpm dev`, no device, no APK. The waking-rest HR is derived in SQL here and **is not a
shipped code path**. Every correlation is same-day, single-subject, n = 35–51, and
`perceived_recovery` is a 5-point ordinal treated as continuous. A correlation of 0.29 is weak in
absolute terms — the claim is that baseline-relative is **twice raw**, not that either is strong.
