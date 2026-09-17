# 2026-09-17 — `fix/bf172-session-fit-not-readiness`

**BF-172** — the "Why <session>?" screen called the session-**fit** score "readiness". v1.457.9.

`overallScore` is `recovery·w + balance·w + freshness·w` from `computeAiDynamicNextSession`: how well
this session fits today, given what is recovered and what is overdue. Nothing about it measures the
lifter. The ring captioned it *"Overall readiness for this session"* and ran it through `scoreBand`,
so the owner's screenshot reads **84 HIGH** in green directly above `SignalSections` printing *Oura
readiness 37 · Low*, *HRV well below your usual*, *Deload: strong deload advised*, energy *drained*.

Same class as BF-154: a number correct in its own terms, under a caption belonging to the quantity
it replaced. Nothing is miscomputed, and the arithmetic is untouched.

## The fix

Caption is now *"How well this session fits today"*, and the ring prints **Strong fit / Fair fit /
Poor fit**.

**The fit words are mapped from `scoreBand`, not derived from the score.** CLAUDE.md bans
re-deriving the 70/50 thresholds with local label strings — two divergent copies have been found that
way — so `scoreBand(score)` still owns the thresholds and the colour and only the vocabulary is
remapped (`High → Strong fit`, `Moderate → Fair fit`, `Low → Poor fit`). `scoreBand` itself is
untouched, and its ~15 other callers are all scoring real readiness and are correct.

## Two of the entry's instructions were adjusted, both for rules it had not checked against

- It offered *"either no band word or a fit-specific one"*. **No band word is not available here.**
  The ring and the number are band-coloured, and `score-ring.tsx`'s own comment records that the
  label exists so the band is not carried by colour alone — dropping it would reintroduce exactly the
  colour-only state that comment was written to prevent. Shipped with the fit-specific word.
- It said change the band *"at this call site, not inside `ScoreRing`"*. That caution is right about
  `scoreBand`, which has ~15 callers. But **`ScoreRing` is session-explain's own component with
  exactly one caller** — `app/session-explain/components/score-ring.tsx`, used only by
  `session-explain-content.tsx`. The `ScoreRing*` symbols in `components/more/home-widgets-section.tsx`
  and `components/oura-score-chip-row.tsx` are an unrelated home-preference type, which is what makes
  a bare grep for "ScoreRing" look like a shared component. The vocabulary lives in the component,
  where it cannot leak, and a comment says so.

## What was verified

- `app/session-explain/__tests__/bf172-fit-not-readiness.test.ts` — **4 of 6 assertions fail against
  `main`**. The other two are pins: `scoreBand`'s three bands are unchanged, and there is no local
  threshold arithmetic. One assertion walks every band so a new one cannot render `undefined`.
- `e2e/bf172-session-fit-not-readiness.spec.ts` — **passes**, and **fails against the unfixed
  screen**. It stubs `/api/next-session` with the owner's screenshot: fit 84 over readiness 37 with a
  strong deload advised. The entry said browser is enough, and this is that.
- Full suite **7583 passed**, `pnpm check:rules` **Ran 75 of 75**, test-typecheck none above
  baseline, lint 0 errors, build clean.

**No `Verify: device` field.** The entry judged the browser sufficient and the browser now holds the
reproduction; nothing here is native, offline-first, safe-area or gesture. What the stub does not
cover is a real recommendation payload — the numbers on screen came from a fixture, so the screen has
been proved to *label* correctly rather than to label real data correctly.
