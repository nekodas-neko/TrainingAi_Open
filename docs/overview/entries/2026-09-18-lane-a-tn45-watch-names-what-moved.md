# 2026-09-18 — TN-45: the only band that ever fires now says what moved

**Branch:** `lane-a/tn45-watch-names-what-moved` · **Lane A** (engine half of an A-then-B entry) · no migration

## What was wrong

`watch` is the only illness band that has ever fired — **2 days in 72**, against **0** for `elevated`
and `fever` — and it was inert twice over. `ILLNESS_READINESS_PENALTY.watch = 0` is deliberate
("advisory-only"), and the Home banner returns `null` for anything that is not `elevated`/`fever`.
**So the band is named advisory-only and there is no advisory.**

Worse, its copy named nothing: *"Some biomarkers are drifting from your baseline."* The data behind
that sentence already knew which ones — `IllnessResult.biomarkers` carries `{ z, contribution }` per
biomarker, commented in the source as *"the 'why', for the advisory"* — and the advisory did not read
it.

## What shipped

`illnessAdvisory(flag, biomarkers?)` names the one or two biomarkers actually driving the score:

> **Resting HR and HRV are drifting from your baseline — worth keeping an eye on.**

**Ranked by `contribution`, not by raw `z`** — that is what the number in front of the reader was
made of. Temperature holds 40% of the weight, so a small z can out-contribute a larger one, and a
test pins that ordering. Biomarkers contributing zero are never named: on a `watch` day most are at
zero, and listing them describes the metric set rather than the event. Capped at two, because the
owner asked for one calm sentence.

**The second parameter is optional**, so every existing caller keeps the previous wording. Nothing
else moved: no threshold, no readiness penalty, `watch = 0` intact. The entry's two "do not"
warnings are both still true of the code.

## The copy constraint, and why it is not cosmetic

Both firings were caused by something other than illness — the owner started Retatrutide on
2026-09-07 and resting HR and HRV track the doses with a 2–4 day lag (TN-46). A line hinting at
infection would have been wrong on **100% of the occasions this feature has ever appeared**. So the
wording names the measurement and nothing about what it might mean, and a test asserts the string
never matches `/fever|infection|fighting|sick|unwell|ill\b/i`.

## A test was rebuilt rather than tuned

The first version of the production-day case reconstructed the z-scores from the entry's prose and
scored **`normal`**, one band below what it was asserting. The fix was not to nudge the numbers until
they passed — it was to read the **persisted** biomarker maps out of
`oura_daily_derived.illness_biomarkers` and test against those. Both real firings are now fixtures:
2026-09-16 (score 41) and 2026-08-27 (score 57). A fixture fitted to its own assertion proves the
assertion, not the code.

## Filed, not left

**The 2026-08-27 firing has no explanation.** It predates the first dose by eleven days and carries an
HRV z of **−4.26** — a bigger move than the medication days. TN-46's *"the cause is now known"* covers
09-16 and cannot cover this one. Recorded on TN-45 so it is not assumed settled.

## What is still owed

**The render — and it is the whole ask from the owner's side.** The guard at
`components/home/illness-advisory-banner.tsx:15` still returns `null` for `watch`, and the owner chose
a quiet line under the readiness score rather than reusing the amber banner (the loudest UI on the
quietest signal is how a banner gets ignored). **Until Lane B ships that line, nothing renders and the
pass test is not met.** TN-45 stays queued with a `Keep:` saying exactly that.

## Verification

Full suite green by real exit code; `pnpm check:rules` 75 of 75; typecheck clean. 11 unit tests.
**Mutation pass: 5 mutants, all killed** — ranking by z, the zero-contribution filter dropped, the cap
raised to three, the verb forced plural, and the fallback path removed. **Equivalent control**
(`> 0` → `!== 0 && > 0`) stayed green.

**Not exercised:** nothing renders this string yet, so it has not been seen on a screen. No device.
The production figures are reads of stored columns, not re-derivations.
