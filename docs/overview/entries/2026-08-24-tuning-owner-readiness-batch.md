# 2026-08-24 — the owner's readiness batch: what was real, what was the model, and what BugFix should build from

*Tuning · docs-only · branch `docs/tuning-wrap-2026-08-24`*

Wrap-up for a session that answered four owner questions and filed seven entries. The three reviews
carry the measurements; this records what the documentation now says and why.

**Reconciled `projectOverview.md`** with three new Known-Issues rows — TN-2 (Body Battery floors by
early afternoon), TN-6 (the temperature baseline is 0.363 °C low, penalising readiness on 89% of
days) and TN-5 (the sleep calibration's 8-fold gain spread, filed explicitly as *not* a fix for the
volatility that prompted it).

**Corrected the LA-20 row and filed TN-7.** LA-20 records the same `daytime-stress: constants not
set` fault at 19 occurrences with a 12:27 latest — read while it was still firing. It actually ran to
**20:59 UTC on 2026-08-23, 31 times**, then stopped on its own before any fix existed. One clean
`/api/body-battery` run is confirmed at 2026-08-24 11:20:38 UTC. **But TN-4's guard (#415) catches
this failure and only `console.error`s it**, so from ~13:00 UTC that day a recurrence writes nothing
to `error_events` — and LA-20's `Keep:` asks for exactly a zero `error_events` count. The condition
can no longer fail. TN-7 is the one-line fix; until it lands, that row must not be struck on silence.

**Compacted the Tuning baton 582 → 99 lines**, which is the PS-4 item. That entry named this baton as
the outlier that would not come down as a by-product of a routine handoff, because its bulk was
narrative rather than state. It came down by moving the narrative into the three dated reviews and
the handoff it already cited. Five of six batons are now at or under ~170 lines.

Lane A is already building from this work — #415 shipped TN-4, #417 landed a TN-2 enabling refactor,
and `426cbfbb` records that TN-2's fit **cannot run from a session container**.

Handoff: [`docs/handoff-2026-08-24-readiness-scores-owner-batch.md`](../../handoff-2026-08-24-readiness-scores-owner-batch.md).

**Not exercised:** no code ran this session — SQL against production plus source reading, no
`pnpm dev`, no device, no APK.
