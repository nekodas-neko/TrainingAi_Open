# 2026-09-14 — one scale, two people: the band was already measurable and nobody had measured it (BF-58)

**Branch:** `lane-a/bf58-weight-band-attribution` · **Lane A** · v1.456.12

## What shipped

`/api/scale-ble/samples` now splits a weigh-in three ways instead of two:

| Distance from the last confirmed weight | What happens | Status stored |
|---|---|---|
| ≤ `SCALE_WEIGHT_CLAIM_PCT` (8%) | saved, no prompt | `confirmed` |
| up to `SCALE_WEIGHT_ANOMALY_PCT` (15%) | *"is this you"* | `pending` |
| beyond that | declined, no prompt | `dismissed` |

That is option D, which the owner chose on 2026-08-30: two phones hear one radio, each app claims
only its own owner's band, neither learns anything about the other person. No linking, no shared
account, no server-side scale owner, no cross-account write — and none of the consent surface that
option B (readings offered to a linked household member) would have needed.

**The raw frame is archived in all three branches.** BF-58's title is that the partner's weigh-ins
are *thrown away*; `insertScaleRawSample` now runs before every return, so a declined reading is
un-attributed rather than destroyed. The day her phone is paired, hers are in the table.

`dismissed` rather than a fourth status, deliberately: it is already what a reading the owner taps
*Not me* on becomes, and "not this user's" is exactly what the band decided. A new status means a
schema change, and BF-58's own scope guard says a design step reaching for one has left option D.
That guard fired for real — a first draft reached for a `'declined'` status and `tsc` rejected it
against `ScaleSampleStatus`, which is the guard working rather than an obstacle.

## The part worth keeping: both weights were already in the database

The entry said to pick the band width *"from the two real weights rather than a round number"* and
read as though that meant asking the owner. It did not. Both clusters were already stored, and
nobody had looked. Measured against production on 2026-09-14 (`claude_ro`, so **the owner's rows**):

- `body_metrics`, 100 confirmed readings — **67.6 – 72.8 kg**; day-to-day change **0.39 kg mean,
  1.40 at p95, 2.85 worst**.
- `scale_raw_samples` — `confirmed` n=100 at **70.0 – 72.8 kg**; `dismissed` n=6 at **57.5 – 58.0
  kg**. A **12.0 kg** gap, and the dismissed cluster is tight rather than scattered, which is what
  says it is a person and not decode noise.

8% of ~70 kg is ±5.6 kg. That is **wider than his entire five-kilogram history**, so no genuine
reading of his falls outside it even after a long gap, and still **6.4 kg clear** of her cluster.
The old single 15% band (±10.5 kg) reached down to 59.5 — 1.5 kg from her readings, which is the
thin margin the entry was written about.

The width is therefore arithmetic against two measured clusters, not a judgement call. It is written
into the constant's doc comment rather than only here, because the next person to touch it needs the
numbers, not the conclusion.

## What I did NOT do, and why it is filed rather than fixed

Turning the outer band from *ask* into *decline* has a failure mode for the owner that option D's
design does not cover: **the band is anchored on his last confirmed weight, and only a confirmed
reading re-anchors it.** A genuine change of more than 15% between two weigh-ins — a long gap plus
an illness or an injury — puts him outside his own band with nothing to move it, and every reading
after that is outside too. Before this change, that case raised the prompt and one tap fixed it.

It is narrow (drift is gradual and normally passes through the 8–15% prompt band first, where one
confirmation re-anchors) and nothing is lost (the frames are archived). But it is **silent and
self-sustaining**, which is the bad half, and `listPendingScaleSamples` is the only read path — it
filters to `pending`, so a dismissed reading has no way to be seen.

Filed as **LA-108**, immediately below BF-58 in the queue. The likely shape is a read for recent
dismissed samples (Lane A) and a list beside the existing pending one (Lane B) so a wrongly-declined
reading can be claimed and re-anchor the band. **Not** a wider band — the 8% is the measurement, and
widening it is the thing BF-58 was filed to stop.

## What BF-58 keeps

Everything that needs the hardware, none of which the band work could answer:

1. **Can both phones hold a GATT connection at once?** Inferred from the protocol shape, never
   measured. `ScaleBleScanManager` uses the advertisement only to wake the app; `ScaleGattClient`
   then opens a connection to read the frame, and a consumer scale of this class normally accepts
   one at a time.
2. **Does `REQUEST_STORED_MEASUREMENTS_CMD` (`0x22 0x04 0x15`) get a reply?** This is the one that
   decides whether the race matters at all — if the scale buffers, the losing phone catches up on its
   next connect. The code's own comment is candid that the command is speculative and borrowed from
   a different firmware generation.
3. **Have the partner pair the scale in her own app.** The pairing is `localStorage`
   (`ta_paired_scale_v1` — no `user_id`, no table, no uniqueness constraint), so nothing stops her
   phone pairing it today.

## Verification

Nine tests in `app/api/__tests__/scale-ble-weight-band-attribution.test.ts` cover the three bands,
both boundaries to within 10 g, the symmetry of a light reading, the first-reading case where there
is no band to be outside of, the partner's real 57.8 kg cluster, and that the frame is archived in
every branch.

Mutation pass, real exit codes captured directly:

| Mutation | Caught |
|---|---|
| claim band collapsed back to 15% (the old two-band behaviour) | ✅ |
| outer band prompts instead of declining | ✅ |
| declined frame not archived | ✅ |
| **control** — middle band rewritten as a closed interval (equivalent) | correctly passed |

**Not exercised:** the S25. This is a JS/server change and reaches the device through Railway with
no APK, but the behaviour it changes is a physical one — two people and a scale — and only the phone
can show it. Recorded as a Known Issue until it is.
