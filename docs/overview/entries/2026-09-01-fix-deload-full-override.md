# 2026-09-01 — BF-64: `Full · Override` now overrides something

**Branch:** `fix/deload-full-override-actually-reverts` · **Domain:** `workouts` · **Lane:** B · **Version:** v1.422.0

## The bug

The owner, on the Pull pre-workout screen: *"pressing full or deload doesnt change the
'prescription' not sure if its over writing it."*

It was overwriting in one direction only. `session-data.ts` applies the deload override inside an
`else if` that runs **only when the prescription's exercise is not already deloaded** — so the
pipeline could ADD a deload and never remove one:

| Prescription | Toggle | What ran |
|---|---|---|
| full | Deload | deloaded — the override lands (Q-109/Q-175 built this) |
| deload | Deload | deloaded |
| deload | **Full** | **still deloaded — nothing un-deloaded it** |

Meanwhile the toggle rendered `Full · Override`, because `prescribedDeload` is derived from the live
prescription. The word **Override** is the app stating it will override the prescription. It did not.
That is worse than BF-8, which it descends from: BF-8 was the toggle *disagreeing* with the card;
this was the toggle *offering a control that does nothing*.

The tell was the picker directly below it. `SessionDurationPicker` POSTs `/prescribe` and regenerates;
`DeloadToggle` set local state that only re-keyed a cache. Two controls side by side, one wired to the
engine and one not — and the prescribe route takes no intensity input at all
(`PrescribeBodySchema` is `excludeSessionId` + `durationPreset`), so intensity had no server path even
in principle.

## The fix, which the entry had already argued for

Session-level `Full` is the **per-exercise revert applied to every deloaded exercise**. The machinery
was already built and already on the device: each deloaded prescription exercise carries a `preDeload`
block, `session-data.ts` unpacks it into `preDeloadStyle`/`preDeloadSets`, and `applyDeloadReverts`
already reverted one exercise at a time from `DeloadInfoSheet`. No LLM call, no 429 budget, works
offline. A `/prescribe` round-trip would have cost a rebuild to reach numbers already in hand.

Three rules were extracted to `components/workout/utils.ts` — partly because `workout-screen.tsx` is a
shrink-only hotspot where the rule is *extract, do not append*, and partly because they are what the
guard needs to reach:

- **`isFullOverride`** — keyed on the **explicit choice**, never `deload === false`. `deload` seeds
  false and only adopts the prescription in an effect, so on first render it is false while the
  prescription is a deload and the user has chosen nothing. Keyed on `!deload`, the revert would paint
  full weights for a frame and snap back.
- **`deloadRevertNames`** — the union of the user's per-exercise reverts and, under an override, every
  deloaded exercise with pre-deload numbers.
- **`deloadOverrideBlocked`** — the deloaded exercises it could **not** revert. `preDeload` is
  optional, so those stay deloaded, and the card names them. Reverting most and silently leaving two
  is the failure this fix would otherwise have introduced while fixing the first one.

**1RM accounting follows without a separate change, and that is design rather than luck:** the revert
clears `deloaded`, `handleLogSet` already reads the reverted array, and `deload` is false under an
override — so a reverted exercise runs full weights and counts, and one that could not revert does
not. `fix/deload-provenance-and-previous-1rm` fixed a bug in this exact area before, so it is live.

The card gains `· Full override on` and a block naming the blocked exercises. **The card's heading was
not changed to match the toggle** — the prescription is still a deload; the session running is not,
and both are true.

## The guard

`components/workout/__tests__/deload-full-override.test.ts`, 11 tests. **Five mutations, five
failures:** keying the override on `!deload`, reverting exercises with no pre-deload numbers, applying
the override when it is off, dropping the blocked-exercise list, and — the data-corrupting one —
making `applyDeloadReverts` stop clearing `deloaded`.

One assertion was wrong on the first write and the test caught it: `estimateOneRm` returns
`estimated1rm: 0` for a deloaded exercise, not `null`. Asserted against the real function afterwards.

## Verified on `pnpm dev`, against a hand-built fixture

The local seed has **zero `session_periodization` rows and no `ai_dynamic` program**, so the toggle
does not even render and the whole path is unreachable out of the box. Seeded: an `ai_dynamic`
program, an `auto_applied` deload prescription on the session the scheduler actually offers, with two
exercises carrying `preDeload` and **one deliberately without** — the blocked case.

| State | Result |
|---|---|
| Nothing chosen | No override notice; 3 `Deload` badges. **The first-render flash guard holds.** |
| `Full` chosen | Card: `Deload session · ~45 min · Full override on`, and *"Most exercises are back to their pre-deload weights and sets. Bicep Curl stays deloaded — the prescription did not record full numbers for it, so its sets will not count toward your 1RM."* Deadlift and Lat Pulldown lose their badge; **Bicep Curl keeps it.** |
| `Deload` again | Notice gone, all three badges back. |

## Filed while here

**LB-46** — the expanded prescription card rendered `4×5 @ 128.75kg (80%)` for a stored exercise of
`3×5 @ 60%`, i.e. the *pre-deload* figures under a `Deload session` subtitle. **Attribution measured:
it reproduces on `main`** with the same row, so it is not this change. **But the row was hand-built**,
so it may be a fixture shape the engine never emits — the entry says to settle that against a real
production prescription before touching any code.

## Not exercised

- **The S25.** Nothing here is device-verified, and the entry scopes its verification to the device
  outright. What was checked is the revert, the blocked-exercise wording and the badges on a
  fabricated prescription; what was not is a real AI-dynamic day, and **completing a set under each
  toggle position to see the 1RM actually count or not** — which is the half that corrupts data.
- The reverse case (a **full** prescription with `Deload` picked) was not re-exercised. It is
  untouched by this diff — the `else if` it runs through is unchanged — but untouched is not tested.
