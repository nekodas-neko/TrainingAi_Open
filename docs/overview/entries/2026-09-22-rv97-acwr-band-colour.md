# 2026-09-22 — RV-97: the ACWR number was the "High" colour in every band

**Branch:** `fix/rv97-acwr-band-colour` · **Lane:** Implementation B · **Version:** 1.464.7

## What shipped

`components/health/training-load-card.tsx` painted its headline `style={{ color: '#f59e0b' }}` — a
hard-coded literal that is **exactly** what `acwrBand()` reserves for the `high` band. The band
*word* beside it came from the real `interpretation`, so an ACWR of **1.05** rendered
*"✓ Optimal zone"* with the number in warning amber, directly above body copy at `:91` calling
0.8–1.3 the green zone. The card contradicted itself twice on one line.

`acwrBandByKey()` had existed at `acwr.ts:90` for this exact caller and was not imported. It is now.
The card's `accentCardStyle('#f59e0b')` identity is unchanged — only the *value* takes the band.

## The entry's open question, and why its fix does not compile

RV-97 asks whether `interpretation` can carry a key outside `AcwrBand['key']`. **It can.** The
route's union has **six** members (`optimal | high | very_high | low | insufficient_data |
baselining`) and `acwrBandByKey` takes four. The entry reasons that the coloured branch is
unreachable for the other two because earlier branches handle them — which is true at runtime, and
irrelevant to the compiler: `insufficient` and `baselining` are **booleans, not type predicates**,
so they cannot narrow the property for the branch below. `acwrBandByKey(trainingLoad!.interpretation)`
as written is a type error.

So the key is narrowed explicitly into its own `bandKey`, and the unreachable arm inherits the text
colour rather than inventing one — a lookup miss that returns `undefined` and then reads `.color`
is a crash, which is a worse failure than the wrong colour this entry is about.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean; lint clean.
- **Controlled, and the count is stated rather than implied: 1 of the test's 4 cases goes red**
  against the unfixed card. The second guards a *wrong* fix — re-banding the raw number at the call
  site, which is what `acwrBand` was extracted to end — and passes on the unfixed card because it
  does not band at all. The last two characterise the shared helper and would pass either way; they
  are there because the card's body copy makes a promise about 0.8–1.3 that nothing else checks.

**Not exercised:** no device sitting. A colour change on one number, in no device-gated class.

## Also in this PR: the baton, rewritten in full

`docs/agents/state/implementation-lane-b.md` had fallen **four merged PRs behind** — #1392, #1395,
#1396 and #1398 shipped with only its Next ID bumped. It is rewritten rather than appended, per its
own rule. Two lessons were merged to stay inside the 65-line ratchet: the vacuous-guard rule folded
into the control rule it is a case of, and the Morning Check-in modal into the Playwright bullet
beside it. The new material worth carrying is the control-run lesson from RV-89 — **a control that
stops at the first failed assertion never exercises the ones below it** — and the RV-91 one, that a
repo-wide source scan must exclude the file making the claim.
