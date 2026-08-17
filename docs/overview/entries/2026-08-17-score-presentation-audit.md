# 2026-08-17 — Q-281's audit, and the one colour-only-state violation it found

**Branch:** `claude/implementation-lane-b-0o7kb9` · **v1.318.10** · **Lane:** Implementation B

## What this was

Q-281 asks for every surface rendering a pillar score to be enumerated and scored for contributors /
trend / action, and its own sequencing says to **do the audit now and hold the UI work** until
Q-500 / Q-272 / Q-275 / Q-277 settle the numbers — otherwise it gets done twice. It carves out one
exception: fix anything failing the repo's colour-only-state rule first, since that is already a
`CLAUDE.md` violation and is the cheapest subset.

That is exactly what shipped: the audit, plus that one subset.

## The audit

[`docs/reviews/2026-08-17-score-presentation-audit.md`](../../reviews/2026-08-17-score-presentation-audit.md).
Fourteen surfaces. **Nine of fourteen render a score with no contributors and no trend**, and exactly
one surface — `health-score-detail.tsx`, reachable only by tapping through from Home — has all three.

## The fix, and the one that was deliberately not made

Two candidates matched the colour-only-state rule. Only one is real.

**Fixed:** of the twenty selectable Home score-ring styles, `accentring` is the only one that renders
a state cue at all, and it rendered it as an 8 px `aria-hidden` band-coloured dot with no text. The
band word reached the aria-label, so a screen reader had it and a sighted user with a red/green
deficit did not. The word now rides beside the dot at 7.5 px, which leaves the cue's height — and so
the row's — unchanged. The other nineteen styles render no state colour at all, which is the absence
of the cue rather than a violation, so nothing else moved.

**Not fixed, on purpose:** `FactorBar` colours both the bar and the trailing number by band and
renders no band word — a literal match for the rule. But the trailing number *is* the sub-score, in
text, right beside the bar, so the state is already carried in a non-colour channel, which is what
the rule protects. Adding "High/Moderate/Low" to each of 5–7 rows would crowd the densest surface in
the app to restate what the number already says. Recorded in the doc as inspected-and-declined so it
is not re-filed as an open violation next time someone greps `scoreBand`.

## Three corrections to Q-278, which is the entry this most affects

Q-278 is about score coverage and absent-vs-zero. The audit contradicts two of its premises:

1. **"Typically a gap, a carried-forward value, or nothing, depending on the surface"** is not what
   the code does. Every surface independently arrived at the same behaviour — `—` on Home and
   day-detail, `—` with a muted ring and the band label *suppressed* on the detail hero, and the
   element hidden entirely on the timeline, day-sections, sleep card and stress tiles. **No surface
   renders a null score as 0 and none carries yesterday's value forward.** What is missing is only
   the *why*, which makes Q-278 one explanation layer rather than a defect sweep.
2. **Two of the five "pillars" have no score surface to fix at all.** Daytime stress is two *minute*
   tiles nested inside `/health/activity`; resilience is one conditional tile inside
   `/health/readiness`. Whether they are pillars is a decision Q-278 has to make before it
   generalises a representation over five of them.
3. And a scoping note in the other direction: **`packages/shared/src/health/score-audit/` has zero
   user-facing consumers** — two admin routes, one admin tab, one producer. Q-281 describes the
   machinery as existing and partly used; for that layer it is entirely unused, so a plan saying
   "wire up the existing layer" is building the first consumer. `scoreAvailability` likewise has
   exactly one consumer, `readiness-breakdown.tsx`, which makes Q-278's scope item 1 cheaper than it
   reads.

## Guard

`e2e/score-band-not-colour-only.spec.ts`. It sets the style preference via `addInitScript` before
`goto` (it is a localStorage pref read on mount, and routing through the settings UI would let an
unrelated screen break the guard), reads the band out of the cell's aria-label, then requires that
same word to be visible inside the cell.

**Mutation-checked**: deleting the word span fails it — verified by actually removing the span and
watching the run go red, then restoring. Asserting on the *word* rather than the dot is what makes it
a guard; the dot is present either way.

## What was NOT exercised

- **The device.** Chromium under Playwright at 412×915. The 7.5 px band word is the kind of thing
  that needs eyes on the S25 — it is legible in the harness screenshot, but small type on a real
  panel at real distance is a different question, and this is a *style the owner can select*, not the
  default. **Owed: a look at Home with "Accent ring" selected on the S25.**
- **Contrast.** Not measured, on either theme, for any band colour. That is Q-282's gap and this
  change does not close it — the word inherits the same band colour the dot had, so it is exactly as
  contrasty as the dot was.
- **The other nineteen styles** were read, not run. The spec exercises `accentring` only.
- **No score model was touched.** The audit is source-level and the fix is presentation.
