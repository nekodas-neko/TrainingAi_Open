# 2026-09-25 — RV-99's one real defect, and why the other 113 sites went to the owner instead

**Branch:** `lane-b/rv99-workout-clocks-green` · **Lane:** Implementation B

RV-99 asks Lane B to replace ~180 copy-pasted band hexes with the design tokens. Measuring before
migrating turned one sweep into two quite different jobs, and only one of them is engineering.

## Measured first

**116 occurrences across 48 files** in `components/**` + `app/**` (65 green, 48 red, 3 amber). None
of the four must-not-touch files the entry names is in Lane B's paths at all.

Then the question that decides everything — does migrating change what renders? The app is
dark-only, so against the `.dark` tokens:

| | today | after | sRGB distance |
|---|---|---|---|
| green | `rgb(34,197,94)` | `rgb(86,238,102)` | **67 — clearly visible** |
| red | `rgb(239,68,68)` | `rgb(255,100,103)` | **50 — visible** |
| amber | `rgb(234,179,8)` | `rgb(239,175,0)` | 10 — imperceptible |

The green figure matches the number RV-99 itself states, which cross-checks both. So ~113 of the 116
are a visible, app-wide restyle of colours the owner reads daily.

## So most of it is not Lane B's call

A whole-app colour shift is a product preference, the one category CLAUDE.md keeps with the owner,
and building it correctly would still risk producing an app he does not want — which is exactly the
failure the mockup rule exists to prevent. Split out as **`LB-152`, `Lane: O`, `Ask: owner`**, with
the table above and three answers that each unblock it. Notably (b) — retune the token to today's
hex, then migrate — gets the same one-source benefit with no visual change at all, so the question
is genuinely open rather than rhetorical.

`Ask:` turned out to be a real field, not prose: `check-backlog-pointers` rejected a sentence there
and told me its only value is `owner`, which is what puts the entry in the always-visible section.
The wrong shape would have filed a question nobody sees.

## What shipped: the one genuine defect

`components/workout/workout-clocks.tsx` painted the same `isDone` state two ways — the ready ramp in
`var(--accent-green)`, and the warmup ramp **directly below it** in `#22c55e` and
`rgba(34,197,94,…)`, at the *identical* 30/7/12% mixes. Two greens for one meaning, stacked on one
screen. Five literals migrated.

**Its `#ef4444` was deliberately left alone.** Checked before touching it: the overtime red agrees
with three sites in `rest-ring.tsx`, so nothing disagrees, there is no defect, and migrating it
would have been an unrequested restyle.

That test — *is there a second value for this same meaning?* — is what separates a defect from a
preference, and it is the tool for the remaining 46 files whichever way the owner answers.

The comment at `:101` claiming these hexes were "not this component's to churn" is replaced. It was
true for the PR that wrote it; RV-99 is the entry that churns them.

## Not exercised

The rendering. This is a colour change and nothing here was opened on the S25 or in a browser — what
is verified is that the literals are gone, the percentages match the ramp above, and the hex ratchet
(shrink-only) went down rather than up. A device look at the warmup ramps is the real confirmation
and is owed whenever the next sitting happens.
