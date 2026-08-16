# 2026-08-04 — Guided walk gets a treadmill (no-GPS) mode (Q-66)

**Branch:** `feat/guided-walk-treadmill-mode` · **Domain:** cardio · **Version:** 1.254.0

## What shipped

A **Treadmill** toggle on the walk config. In that mode:

- `startGpsWatcher` is **never started** — not started-and-discarded. Indoor GPS is multipath noise;
  not asking for a fix is the only version with nothing to get wrong, and it saves the battery too.
- The walk saves as `activityType: 'treadmill'` (the existing `is_distance_based = false` row) with
  distance, route, splits, best efforts, pace series and elevation all null.
- The nulls fall out of the **existing** `hasRoute` guard rather than a second code path — with no
  GPS points, `rawPoints` is empty and every derived field is already null.

`treadmill` lives on the persisted `WalkConfig`, so the choice sticks between walks.

## Beyond the plan: the stats card would have dropped these walks

`/api/guided-walk/segment-stats` filtered `activityType === 'walk'`. A treadmill interval walk would
have been **silently excluded from the fast/slow card the owner is doing the intervals for** — the
one screen that makes the workout worth doing.

Including them is safe, and the reason is worth stating: `aggregateSegmentsByKind` already filters
nulls **per field**. A treadmill segment therefore contributes its real heart rate to the HR average
and contributes *nothing* to the pace and distance averages. There is no dilution to guard against.
Two tests pin exactly that — mixing an indoor segment into an outdoor set moves `avgHr` and leaves
`avgPaceSecPerKm` and `totalDistanceKm` byte-identical.

## The rehydration trap

Zustand's `persist` replaces the whole `config` object from storage, so a config saved before this
field existed rehydrates with **no `treadmill` key**. Every read site uses `config.treadmill === true`
so `undefined` reads as "outdoors" — today's behaviour — rather than silently switching GPS off for
an existing user. A test pins it.

## Verified

- `treadmill` exists with `is_distance_based = false` in **production**, checked directly, not
  assumed. Worth doing: CLAUDE.md records that this exact flag sat wrong in prod for months because
  a seed cannot correct a drifted row.
- 5 tests; typecheck and lint clean.

## Not verified

**On device, and the UI was never rendered.** GPS does not run in the sandbox, so "the watcher never
starts" is verified by reading the guard, not by watching it not happen. The toggle's appearance at
the S25 viewport, and a real treadmill walk saving end to end, are both unchecked. No native surface
is touched — it reaches the phone through Railway with no APK.
