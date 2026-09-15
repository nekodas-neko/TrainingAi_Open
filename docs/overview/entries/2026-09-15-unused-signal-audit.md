# 2026-09-15 — what else our data could tell us, and one retraction

**Tuning.** Docs-only. The owner asked what other metrics could be calculated from data already
held. The audit looked for stored-and-unused signal rather than proposing new measurements, and the
best finding was not a new metric at all — it was that an existing one has never been checked.

## The headline

**Daytime stress is imputed and the ground truth is in the database.** The ring streams HRV events
for ~7% of waking hours, so the model fits a regression on night data and applies it to daytime HR
and temperature. That imputation drives `stress_high_minutes`, which drives the deload override
that fired on 10 of the last 22 days.

The chest strap writes raw beat intervals — 136,440 over 48 days — and is worn **07:00–13:00,
peaking at 08:00**. That is the window the model is guessing about, and twelve of the last fourteen
strap days carry thousands of beats on days the model also ran. `rmssdFromRr` already exists and
already runs on this data for workout windows. Comparing the two is a measurement, not a project.

Filed as **TN-39**, with the constraint that the output is a number and a verdict, not a patch —
scoring changes stay owner-signed.

## The same beats feed three models they never reach

`rollup/run.ts` runs LF/HF, breathing rate and the 5-minute HRV series **on ring IBI only**. The
strap's reader is called from two places, and the strap's 136,440 beats yield exactly one number: a
workout's rest-window rMSSD. Because the strap is worn in waking hours, pointing those models at it
would produce daytime LF/HF, breathing rate and HRV series — signal the app has from no source
today. Filed as **TN-40**, gated behind TN-39 because the agreement result decides whether these
merge with the ring series or stay separate.

## Retraction

Earlier the same day I told the owner nightly HRV could come from the strap today with a pipeline
change only. **The pipeline change is real; the nightly data is not there** — 242 beats across 6
nights, total. PS-44's architectural claim survives, its validation path does not, and the entry now
says so with the hour-grouped measurement attached. A row count of 136,440 looks like plenty until
it is grouped by hour, which is exactly how the mistake was made.

## Two hypotheses tested and killed

- **`ehr_*` is not automatic workout detection.** Event counts run highest on days with no workout
  (802 events / 0 workouts on 09-15; 764 / 0 on 09-11).
- **There are no computed-but-unsurfaced metrics.** Four modules looked dead on a narrow grep and
  all four are consumed once the search widens. Recorded because the same grep will mislead again.

**TN-41** covers the four raw tags stored without a rollup consumer, ranked below the other two and
honest that the value is modest. `0x73` (1,494 episodes) has no decoder and is owner-gated: its byte
layout must come from the `open_oura` Rust source, which now lives only in the archived private repo.

## Not exercised

Docs-only; no code changed, nothing run on device. Every figure is the owner's own account read
through `claude_ro`, which is row-scoped to one user — the wear-pattern and event-count findings are
about this owner's usage and do not generalise to other accounts. No decoder was written and no byte
layout was inferred.
