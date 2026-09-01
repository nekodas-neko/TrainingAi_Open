# 2026-08-31 — the guided walk paces you by cadence, and says which signal it is using

**Branch:** `feat/walk-cadence-pacer` · **Entry:** Q-410 · **Lane:** B · **Version:** v1.411.0

## What was asked

Two owner messages, months apart, that turned out to be one feature:

> *"for the walking section I'd it to show the speed and total step count. rather than a HR goal we
> should be looking at a step goal; we should enough data on how to do this."*

> *"Yes a cadence target — like a SPM to indicate a 'walk faster' option"* … *"Should also be able to
> say to slowdown during the slow part. so pacer for speed/steps both ways"*

Plus a review of the drawn version: *"color code the bar based on whether its in the right direction
of the pacer; i.e slower than expected = green … green for in range: orange for slightly out; and
red for way off"*, and *"when no source detected for cadence it still shouldn't be BPM; probably
speed would be good there."*

## What shipped

**`lib/walk/walk-pacer.ts`** — a new pure module, the one place the interval walk decides what to
pace you by and how you are doing against it.

- **`readPacer()` walks a precedence ladder: cadence → speed → heart rate**, and returns the band, a
  mark, a sentence, a bar fill and a `fallbackNote` naming the rung whenever it is not the top one.
  Cadence leads because it responds the instant the legs do; heart rate takes 30–60 s to catch up, so
  a prompt driven by it arrives after the moment it is about. That is the owner's instinct and it is
  correct for a reason worth writing down.
- **`bandFor()` bands by *signed* distance, not absolute error.** On a fast block, `spm ≥ floor` is
  green however far above — faster is the point of a fast block. `BAND_TOLERANCE` (10%) is the amber
  ring around it; beyond that is red. It **calls `classifyZone`** for the green/not-green threshold
  rather than restating it, so there is still one definition of "meeting the target" and this only
  adds the ring.
- **`speedTargetsFromHistory()` derives the speed rung's pair from the walker's own past fast/slow
  segments.** `walk-config.tsx` already fetches `/api/guided-walk/segment-stats`, which aggregates
  `avgPaceSecPerKm` per kind across ~3 years — so the target is "your usual fast block", and the walk
  screen reads the same cache key rather than asking for a third target block to configure. It
  returns null rather than half a pair on a history that is too thin (fewer than 3 segments of a
  kind), has no GPS-derived pace at all (the treadmill-only case), or does not separate.
- **`STOPPED_SPM` / `STOPPED_KMH`.** Without them, standing still is a *perfect* slow block: "under
  the ceiling" is green, and 0 spm is very much under the ceiling. Below the floor the pacer reads
  **Stopped** in neutral — it does not scold a pause at a crossing and it does not congratulate one.

**`components/guided-walk/walk-pacer-bar.tsx`** — the bar, the mark, the sentence and the fallback
note. A leaf that owns its own cadence subscription, for the same reason `CadenceReadout` does: the
strap reports about once a second and this screen renders a route map.

**`components/guided-walk/walk-active.tsx`** — leads with **km/h** and keeps min/km beside it, both
off the one pace series. The old heart-rate-only verdict line is gone, replaced by the pacer.

**`components/guided-walk/walk-config.tsx`** — a *Step-rate targets* card holding the cadence **pair**
(`Fast spm ≥` / `Slow spm ≤`, stepping by 5). A pair rather than one number, because a single cadence
figure cannot express the slow half. The shared `NumberField` gained an optional `step` prop; every
existing caller still steps by 1.

## Decisions made here, so they are not re-litigated

- **km/h leads on the live screen; min/km stays in the summary.** The owner asked for speed by name,
  and it is the natural reading for a walk, but the summary's splits and best efforts are in min/km
  and should stay there. Both come off `currentPaceSecPerKm` — there is no second computation, and
  the e2e spec checks the two agree rather than asserting it in a comment.
- **The stopped threshold was decided, not escalated.** The entry flagged it as "worth deciding
  rather than discovering" and left it open. It is a cheap, reversible tuning constant with an
  obvious right answer, so it is a named constant at 40 spm and this line is the record.
- **The cadence pair is deliberately absent from `DEFAULT_WALK_CONFIG`.** Every device already carries
  a persisted config that predates these fields, so `resolveCadenceTargets` has to supply the default
  anyway; a second copy in the defaults object would be the one that drifts.
- **The ring still cannot pace this.** `RING_CADENCE_VALIDATED = false` holds. The ring's cadence is
  octave-ambiguous, not broken, and shipping it uncorrected gives a number wrong by 2× — worse than
  showing none. Correcting it is Lane A's, in `packages/shared/src/health/cadence.ts`.

## What was NOT done, and where it went

- **Per-segment adherence, steps, and which signal paced the segment** — the numbers this pacer
  *creates*, and the most interesting thing to analyse later. They are additions to
  `activity_logs.segments`, which is a schema edit and therefore Lane A, with the local SQLite
  mirror, the outbox payload, `getSyncDelta` and `applyDelta` moving in the same PR. Filed as
  **LA-48**.
- **The ring octave correction** — Lane A, unchanged, and the harder half by a distance.

## Verification — and the parts of it that did not run

- **Full unit suite green:** 693 files, 5823 tests. `pnpm check:rules` **Ran 65 of 65 Custom Rules
  steps**, all passed — including deleting `components/guided-walk/walk-active.tsx` from the
  hex-literal baseline, since replacing the verdict line removed its last literal.
- **29 unit tests** over the pacer. **Every guard mutation-checked** — 12 mutations, all killed:
  the stopped floors (all three, including that heart rate deliberately has none), both halves of the
  amber ring, the minimum-segment floor, the degenerate-pair guard, the ladder's precedence, the
  zero-target rejections and the progress clamp.
- **`e2e/walk-pacer-speed-rung.spec.ts`** drives a real geolocation series against `pnpm dev` and
  asserts (1) km/h leads and equals the min/km beside it, (2) with no cadence source the pacer falls
  to speed and says so, (3) a history too thin to derive a target from drops the rung instead of
  inventing one. **All three mutation-checked**, each against the code it is about.
- **Exercised in `pnpm dev`:** the config steppers (default 120/95, step 5, persisted across a
  reload, `Sets` still stepping by 1) and the active screen end to end with a driven GPS series.

**What was NOT exercised, and it is most of the feature.** The **cadence rung** and the **heart-rate
rung** have never executed: both need a Polar H10 over BLE, and there is no BLE in the sandbox or in
`pnpm dev`. So the bands moving with the legs, the Stopped state on a real crossing, the strap-drop
fallback, and the band colours at 4.5:1 at arm's length are all verified by reading. **LB-36** holds
that pass. `BAND_TOLERANCE = 0.10` is a proposal, not a measurement.

**Also not exercised:** native SQLite / Capacitor (`getLocalStore` is null on web), safe-area insets,
and Samsung's WebView compositor. The walk config and active screens both grew content; neither
bottom-anchored control changed, but neither was seen on the device.
