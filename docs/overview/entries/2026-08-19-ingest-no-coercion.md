# 2026-08-19 — `[]`, `true` and `""` no longer land as readings (Q-495)

**Branch:** `fix/ingest-no-coercion` · **Lane:** Implementation A

## Measured first

`z.coerce.number()` runs `Number(v)` on whatever it is handed, and `Number()` is generous in ways
that produce a *valid-looking* reading rather than an error. Against the running route:

| body | stored |
|---|---|
| `{"steps":[]}` | steps **0** |
| `{"steps":true}` | steps **1** |
| `{"weightKg":""}` | **0 kg** |
| `{"weightKg":[]}` | **0 kg** — not named in the entry, found by probing |
| `{"weightKg":"75kg"}` | rejected, 400 |
| `{"weightKg":1e308}` | rejected, 400 |

Each accepted one landed in `body_metrics` stamped `health_connect`, and 0 kg is in range for
`.min(0)`. The route's own comment was accurate about what it had tested — the two rejected rows are
exactly the examples it names — and silent about the rest.

## Where the prescribed fix would have hurt

The entry says: *"`z.number()` rather than `z.coerce.number()` (Tasker sends real JSON numbers)"*.
That parenthetical is an assumption, and it is the one thing here that could break the owner's live
pipeline: **Tasker builds this body by string concatenation**, so `"steps":"4200"` is a plausible
shape for it to send, and nothing in this repo records which. A sandbox cannot settle it. Measured
that `"steps":"4200"` is accepted today, so switching to a strict number schema would silently start
400-ing every push if that is what the profile emits.

So the two halves are separated. Rejecting `[]`/`true`/`""` closes the measured defect and **cannot**
break a client; numeric strings keep working.

## The floor, checked against production rather than assumed

The entry also asks for *"a plausible floor, not zero"* on body weight. The risk in adding one is that
Tasker might send `0` for a field it has no reading for, in which case a floor 400s the whole push and
loses the steps and calories riding with it. One read settles it:

```
114 body_metrics rows — weight 0: 0 · weight <20 kg: 0 · body-fat 0: 0 · steps 0: 0
min weight 67.55 · max 72.8
```

Tasker **omits** an absent field; it does not send zero. So `weightKg` now uses the shared
`WEIGHT_KG_MIN`/`WEIGHT_KG_MAX` (20–500) rather than a local `.min(0)`, which also removes a
divergence: the web route has rejected sub-20 kg weights all along.

That matters beyond tidiness — 0 kg is what `getMostRecentConfirmedWeightKg` would have served to the
BLE scale's confirmation step and to `deriveActivityKcal`.

## What shipped

- `packages/shared/src/validation/health-connect-ingest.ts` — **new**. `IngestBodySchema` moved out
  of the route so it can be unit-tested at all; Next.js route files cannot export extra values.
- `ingestNumber(bounds)` — a `z.preprocess` that converts a non-empty numeric **string** and passes
  everything else through to a real `z.number()`, so `[]`, `true`, `{}`, `"  "` and `[5]` all fail.
- `weightKg` on the shared constants.
- 8 unit cases covering the four laundered values, the four shapes `Number()` would also launder,
  both accepted forms, the two already-rejected ones, and the floor.

## Verified through the real route after the move

`[]` → 400 · `""` → 400 · `0` → 400 · `"4200"` → 200 (stored 4200) · `72.8` → 200 (stored 72.8).

Full suite with `DATABASE_URL`: **505 files, 4,288 tests, 0 failed.** `tsc` clean,
`pnpm check:rules` **Ran 49 of 49**.

**Two ratchets fired and both were right to.** The strict-request-schema baseline had a row for the
route; the exemption moved with the schema, keeping its original reason (the Tasker payload's shape
is not in this repo). The numeric-upper-bound check flagged my **docstring** — it greps source text,
so the prose token `z.number()` read as an unbounded validator. Reworded rather than suppressed.

## Not exercised

Production, the real Tasker profile, anything on device. **Whether Tasker sends quoted numbers is
still unknown** — this change is deliberately safe under either answer, and the strict-number version
stays available if the payload is ever confirmed. `bodyFat` (0–100 here, 1–80 on the web route) and
`distanceKm` (500 vs 1000) remain divergent from the shared constants; left alone because tightening
them carries the same unverifiable client risk and no defect was measured. No migration, no schema
change, no auth change.
