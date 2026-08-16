# Automatic Activity Detection ONNX — investigation (P3)

**Goal:** determine whether Oura's `automatic_activity_detection_3_x` can drive **auto
activity/exercise detection** from our BLE motion+HR, and if so, plan the build.

This is an **investigation**, not a committed build — the input-feature contract is complex and
unproven on our data. Weights + constants + source are vendored; ONNX **not yet exported**.

## 1. What we have

- `automatic_activity_detection_3_0_8` (1.35M params) and `3_1_11` (3.6M). Rich topology (from
  introspection): conv1d feature extractors, transformer decoder layers, bidirectional GRU
  (`recurrent.weight_ih/hh_l0 + reverse`), MLP heads, `behavior_embedding`, history/context
  transformers, `post_processor.target_embeddings` (84–88 activity classes). `.pt`, `constants.json`,
  source all vendored (in the model bundle / owner archive).
- Output space: ~84–88 activity types (`target_embeddings`) — walking, running, cycling, etc.

## 2. Open questions (the investigation)

1. **Input features:** what exactly does the model consume — motion (`0x72`), HR (`0x5d`), step
   cadence, time-of-day, behavior history? Read `automatic_activity_detection__source` to enumerate
   the full feature/context vector. Can we assemble all of it from BLE + our history?
2. **History/context dependence:** the model has history-segment transformers + behavior embeddings —
   does it need a rolling multi-day context we can supply, or Oura-cloud-side state we can't?
3. **Value:** does auto-detected activity add over the user's explicit workout logging? (This app is
   a deliberate gym tracker — auto-detection may be redundant for strength sessions but useful for
   cardio/NEAT.)
4. **Export feasibility:** transformer + GRU + embeddings — confirm the core exports to ONNX cleanly
   (GRU/attention are supported but the multi-input topology needs a careful native rebuild).

## 3. Deliverable

A GO/NO-GO memo: if the features are assemblable and the value is real, a full build sub-plan
(mirroring the SleepNet one); if not, a documented NO-GO with the blocking reason (missing input /
cloud-state dependence / low marginal value).

## 4. Backlog entry

```
N. **Oura activity-detection ONNX — investigation** — plan
   `docs/superpowers/plans/2026-07-15-activity-detection-onnx-investigation.md`, branch
   `spike/activity-detection-onnx`, added 2026-07-15. Read the model source, enumerate the input
   contract, decide GO/NO-GO on auto activity detection. Lower priority than SleepNet/illness/energy.
```
