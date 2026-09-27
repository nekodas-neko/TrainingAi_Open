# 2026-09-27 — TN-82's mockup: should the morning check-in stop asking? (docs only)

**Branch:** `docs/tn82-morning-checkin-mockup` · **Lane:** Implementation B · **Code changed:** none.

## Why this and not the build

`TN-82` headed Lane B's READY list, and it is not startable as filed: it **removes two inputs from a
screen the owner opens daily**, which CLAUDE.md gates on a mockup at 384 px dark and a yes before any
code. `TN-85`'s own `Keep:` ② already recorded that — a finding from the session that shipped the
durable Home verdict — so this was verified rather than assumed.

Producing the mockup is ungated work, so that is what this session did.

## What was shown

Three frames, rendered from the running app rather than drawn, then reverted (`git diff origin/main`
empty): the sheet as it is today with both scales resting on 3; an ordinary night, where the app
states *"Sleep looks normal — filled in for you"* quietly; and an outlier night, where it states
*"Slept 5h10, 65 min later than usual. Marked this a poor night."* with a **That's wrong** control.

<https://claude.ai/artifact/Wx6SNHDTMVRBhJbCGctTAZ>

The wording is `verdictCopy()`'s, already shipped by `TN-85` — so what the owner is being asked to
approve is the **shape** (scales out, announcement in), not the sentence. The sentence is `TN-84`'s
and is still open.

## What building it exposed, which reading the plan did not

**`sleep-verdict` is the only verdict that exists.** There is no recovery verdict and nothing measures
one. So "replace the two scales" is really **two different changes**: sleep gets an announcement that
can be corrected, and **Recovery loses its input with nothing in its place**. The plan does not
distinguish them; the mockup makes it unmissable, because the Recovery scale simply vanishes from the
frame with nothing where it was.

Recommendation recorded on the entry: **remove Recovery too**, on the plan's own measurement —
`perceived_recovery` has **0 touched answers in 102 check-ins**, so it costs a reading that has never
once been taken. The alternative leaves one scale beside the announcement, which is the arrangement
the plan's §1 argues against.

## A correction made before publishing, not after

The first draft of the page argued: *"the sheet still asks 'Compared to yesterday', which is the same
question in the form you actually answer."* **The plan's own measured table refutes that** —
`vs_yesterday` was placed first specifically to escape the two scales and collected **2 of 82**,
decaying to zero like the other two. Checking the figures against the source rather than the entry's
prose caught it, and the honest argument is the stronger one anyway: asking has failed in **three**
forms and three positions, so a fourth way of asking is not the missing piece.

The same pass replaced a rhetorical "35 neutral 3s" with the measured `0 of 102`.

## Not exercised

Nothing on-device and nothing in the APK: headless Chromium at 384 px, so safe-area insets, real
gesture-nav clearance and Samsung's WebView are absent from every frame. No code shipped, so there is
nothing for a device pass to verify yet — `TN-82` already records that its build needs the APK, since
the morning sheet is the canonical daily surface and the local store is on its write path.
