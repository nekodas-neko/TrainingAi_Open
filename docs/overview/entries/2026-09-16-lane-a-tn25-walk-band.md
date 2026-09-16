# 2026-09-16 — Lane A · TN-25: the walk's fast target stops being unreachable

**Branch:** `lane-a/tn25-walk-band` · **v1.457.5**

The second half of TN-25, and the one the owner would notice. The engine half (#1262) added the
pattern selector; this changes what the pacer actually says.

## The defect

`walk-active.tsx` set the fast target at `hrReserveTarget(0.70, …)` — **133 bpm** for this owner —
and `classifyZone` returned `'push'` for anything under it. Measured: **0 of 44** fast blocks ever
met it, mean **98.5**, best single **115**. So the live cue read *push* on **100%** of fast intervals
across ten sessions. A cue that can only ever say one thing carries no information.

The 0.70 reserve fraction is right for the protocol and wrong for this mode: guided interval walking
is validated largely in older adults, for whom brisk walking does reach 70% of reserve. A 33-year-old
with a 168 max cannot, on flat ground.

## What shipped

`walkFastBandBpm(hrMax)` in `hr-zones.ts` → **[101, 118]** at a 168 max. `ZoneTargets` gained an
optional `fastMax`, and `classifyZone` can now return **`'ease'`** on a fast block — the half a floor
could never say.

**The band is % of MAX HR, not % of reserve, and that was the open design question.** I decided it
rather than deferring, because it is one expression, costs nothing to reverse, and produces the same
numbers today. Three reasons, in the source:

- 60–70% of max is where *"conversational aerobic"* — the words the session's own copy uses —
  actually comes from, so the threshold now matches the model the prescription is written in.
- It stays per-user. Targeting 105–118 literally, as the entry says, is a constant true of one
  33-year-old.
- It decouples the walk from the reserve anchor. That is the coupling TN-30 would otherwise move:
  `0.70 × reserve` goes 133 → 140 on re-anchoring at 178.

**⚠ It returns 101–118 where the entry quotes 105–118** — the standard 0.60 lower edge against the
entry's rounded figure, 4 bpm apart. Named in the source rather than quietly reconciled, with the
one-token change that matches the quote exactly.

**The slow ceiling is untouched** at 0.40 of reserve: it was met on 78% of blocks, so nothing in the
data says it is wrong. Changing what is not broken alongside what is would make the next measurement
unreadable — the mistake TN-25 itself flags about the 2026-09-09 session, which moved three variables
at once.

## What is still owed

**`recommendWalkPattern` still has no caller.** The selector shipped in #1262 and nothing invokes it,
so the pattern is not actually assigned yet — which is the owner's *"I'd like that to be determined
for me"*. The band fixes the **cue**; the selector fixes the **prescription**, and it is inert until
something calls it. TN-25 stays queued for that.

## Verification

- `pnpm test` **925 files / 8796 tests** green. `pnpm check:rules` **75 of 75**. Typecheck and lint
  clean.
- **Mutation pass, 4 mutants, all killed:** ceiling removed, band raised to 0.70–0.85, ceiling applied
  unconditionally (which would break every caller that supplies no `fastMax`), and the push boundary
  moved by one. **Equivalent control** (`bpm < fast` → `!(bpm >= fast)`) stayed green.
- Six new tests, including the control that matters: **a caller with no `fastMax` must behave exactly
  as before**. `fastMax` is optional precisely so this change cannot reach the pacer's other paths,
  and a test holds that rather than the comment claiming it.
- `classifyZone` has exactly two callers (`walk-pacer.ts` and the walk screen), checked before
  changing its contract rather than after.

**Not exercised.** `pnpm dev` returns **307** on `/guided-walk` — the auth redirect — so the screen
compiled but never rendered, and **nothing here was seen behaving on a real walk**. No device, no
APK. The figures (0 of 44, 98.5 mean, 115 best) are TN-25's own measurements and were not re-measured.
The first walk after this deploys is the real test, and it is the owner's.
