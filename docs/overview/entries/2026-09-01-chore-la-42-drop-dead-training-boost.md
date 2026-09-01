# 2026-09-01 — LA-42: the score ring's second arc could not be reached

**Branch:** `chore/la-42-drop-dead-training-boost` · **Domain:** `app-shell` / `activity` · **Lane:** B · **No version bump**

`ScoreDisplay` in `components/health/health-score-detail.tsx` took a `trainingBoostFrom` and drew a
second, brand-coloured arc over the ring for the part of an activity score that came from a same-day
training blend. The prop is gone, with its `hasBoost` / `baseFrac` / `boostFrac` and the `<circle>`
they fed.

**Verified against `main` before deleting**, per the re-verify rule — the entry was filed two days
ago and a plan can go stale in the queue. It has not: `blendActivityScore` is gone (Q-284), and
`adjustment` is a literal `0` at **both** construction sites of this payload —
`lib/health/readiness-payload.ts:426` and the offline seed literal inside this same file at line 174.
So `adjustment > 0` is unreachable, `trainingBoostFrom` is always `null`, and `hasBoost` is always
false. `ScoreDisplay` is local to this file and had one call site.

**Not a regression, which is the whole reason this is safe.** The blend last had an Oura score to
adjust on **2026-07-07**, the re-key day, so the arc had been dead in practice for two months. Q-284
turned that into dead by construction — the difference between "nobody has hit this lately" and
"nobody can", and only the second licenses a deletion.

**No guard, deliberately.** The invariant a test could pin is *`adjustment` stays 0*, which lives in
Lane A's file and would block the revival it is meant to protect. If the blend ever comes back, this
arc should come back with it — a test forbidding that would be wrong. The reasoning is in the
component's doc comment instead, where someone reviving the blend will read it.

The offline-seed literal at line 174 stays: it satisfies the `ReadinessScoreResponse` shape, so it is
contract rather than dead code.

## Verified on `pnpm dev`

`/health/activity`, `/health/readiness` and `/health/sleep` all render their hero ring with the score
and band label intact — 19 LOW, 46 LOW, 55 MODERATE against the seeded data. The deleted arc was the
only thing that changed, and it was drawing nothing.

## No version bump, deliberately

Nothing a user can see changes: the arc was unreachable, so removing it renders the same pixels. The
convention bumps on *user-visible* changes, and inventing a changelog line for an invisible one would
put a claim in front of the owner that they cannot check and that is not true.

## Not exercised

- The S25. Nothing here is device-verified. It is a deletion of an unreachable branch on a surface
  that already rendered correctly, so the risk is low, but low is not zero and the ring is drawn with
  SVG stroke-dash — the thing Samsung's WebView compositor has been odd about before.
