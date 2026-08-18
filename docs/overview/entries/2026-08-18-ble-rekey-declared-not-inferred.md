# 2026-08-18 — a ring re-key is declared, not inferred (Q-314)

**Lane A** · branch `fix/ble-clock-reset-vs-redrain` · migrations **194** + **195** · no Kotlin, no APK.

`isClockEpochReset` opened a new clock epoch on any ds regression over an hour. **A history re-drain
produces exactly that shape.** After a re-pair the app holds no sync cursor, so the ring replays days
of buffered history — a 4.75-day regression on 2026-08-17 — and that read as a ring-clock reset. It
was not: the counter is continuous across the boundary (an **18.6 s** gap) and the minimum anchor lag
agrees across all four epochs to within **50 s**.

The cost is not small. A spurious epoch becomes `currentEpoch`, its offset is estimated from a burst
in which >90% of anchors carry re-drain backlog, and `aggregateOuraRawSamples` resolves every ds
against `currentEpoch` — so **one re-pair re-times the entire sleep history**. It happened twice
(2026-07-30, +12.17 h; 2026-08-17, +14.16 h). The first self-healed in seven minutes when another
epoch opened. The second did not, and became Q-536.

## The decision

The entry listed three candidates and did not choose. **The owner chose "declare it explicitly"
(2026-08-17)**, and it is the right shape for the reason the entry gives: a re-key is a deliberate
act performed with `open_oura` on a laptop, so the app can be *told* rather than left to infer it
from counter shape.

`POST /api/oura-ble/rekey` records a declaration; the **next** ingest batch consumes it and opens the
epoch. Deferred because the new ds is not knowable until the ring reports. `GET` shows what is
pending, `DELETE` cancels a mistaken one — but only while it is un-consumed, because a consumed
declaration names an epoch that already exists and every timestamp derived from it depends on that
row as the audit trail.

## The safety net, and why it is still there

The entry's own warning: *"missing a real re-key is worse and quieter than the current failure."* So
counter shape still opens an epoch on its own — but only when the counter genuinely **restarted**,
which is the discriminator a bare regression lacks.

A re-drain replays history the ring already sent, so its max ds is a large fraction of the ceiling —
**53%** and **89%** on the two real events. A re-key restarts the ring's clock at zero, so the first
batch after one is a small fraction of a ceiling built over months. `EPOCH_RESTART_RATIO = 0.05`
gives a **10× margin** against both measured re-drains.

A ratio rather than an absolute floor because it self-scales: on a ring re-keyed after two years the
ceiling is ~630 M ds, and 5% of that still leaves ~36 days of fresh history before the net stops
firing — where a fixed threshold would be wrong at one end or the other.

⚠️ **There is still no observed true reset in the data**, so this bound is validated only against the
two events it must *not* fire on. That is why the declared path carries the load and this is a net.

Two judgement calls in the classifier worth recording:

- **A declaration does not require a regression at all.** A ring re-keyed mid-buffer can legitimately
  come back with a *higher* ds than the old ceiling; requiring the counter to look restarted would
  silently ignore the owner saying it was re-keyed.
- **The re-drain branch logs loudly.** It is the case that used to corrupt history and it is also the
  ordinary consequence of a re-pair, so it must be visible without being an error — and the message
  names the route to use if the ring really was re-keyed.

## Verification

- **12 pure tests** over the classifier, using the two **real** events as fixtures rather than
  invented numbers: both regress (which is why the old check fired), neither is a restart, both are
  classified `redrain`, and the margin against the bound is asserted directly. Plus the declaration
  winning without a regression, the undeclared-restart net, the ratio boundary, ceiling-scaling, and
  the no-history case (`-Infinity` must not read as a restart).
- **7 DB-backed tests** on the ingest path itself: a re-drain does not open an epoch; a declaration
  opens exactly one on the next batch and is consumed with the epoch it opened; three following
  batches do not open three; declaring twice queues one; a pending declaration cancels and a consumed
  one does not; an undeclared restart still opens one; and it is user-scoped.
- **Mutation-checked**: restoring the old "any regression opens an epoch" turns **four** of them red,
  including both real-event fixtures.
- **Live on `pnpm dev`**: all four verbs — nothing pending, declare, declare again (idempotent, same
  id), pending, cancel, cancel again, and unauthenticated 401.
- Full suite **490 files / 3,993 tests passed** · `tsc --noEmit` clean · `pnpm check:rules` 38 of 38.
- Migrations 194 and 195 applied against the local dev DB; the partial unique index confirmed in
  `\d`.

## Failure surfaces NOT exercised

- **A real re-key.** By construction — there has never been an observed true counter reset in this
  data, which is the whole reason the net's threshold is unvalidated in the direction it exists for.
  Exercising it means actually re-keying the ring, which risks a firmware update that breaks the
  reverse-engineered BLE protocol.
- **The device half.** The declaration is a server-side admin action; nothing in the APK calls it, so
  the owner declares it themselves after running `open_oura`. Making the app declare on re-pair would
  be Kotlin and a new APK.
- **No UI.** `components/oura-ble/` is Lane B's — filed as a follow-up rather than written across the
  lane boundary.
- No device, no Kotlin, no APK.
