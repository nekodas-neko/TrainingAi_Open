# 2026-08-31 — the voice parser stopped disagreeing with what it heard (BF-66)

**Branch:** `claude/implementation-agent-lane-b-43nmep` · **Lane B** · v1.404.2

## The report

Mid-set on Sumo Deadlift, the owner said *"60 for 6"*, the transcript came back exactly right, and
the app printed it in red: *"is that not how to use it?"* That red line is not a mis-hear message —
it is `voice-log-button.tsx`'s **parse-failure** branch, so the app was showing a perfect transcript
back as if the transcript were the problem.

## One character class

`parseVoice` stripped with `[^0-9.\s kgreps×x]` — a denylist that keeps every letter appearing in
`kg`, `reps` and `x`. The `f` and `o` of `for` were dropped; the **`r` survived**, because `reps`
contains it. The final fallback wants two numbers separated by whitespace *and nothing else*, so a
filler word whose letters all fell outside `kgrepsx` vanished and the fallback fired, while one that
left a letter behind blocked it:

| Said | After the strip | Parsed |
|---|---|---|
| `60 for 6` | `60 r 6` | nothing |
| `60 times 6` | `60 es 6` | nothing |
| `60 by 6` | `60 6` | 60 × 6 |
| `60 at 6` | `60 6` | 60 × 6 |

**`by` and `at` worked and `for` and `times` did not**, and no user could derive that rule. Nothing
in the app stated it either — no hint on the button, no first-run text — so the accepted phrasing
was learnable only by failing at it.

## What ships

- **A positive tokenizer replaces the denylist.** `parseVoice` now pulls out only what means
  something — numbers, `kg`/`kilos`/`kilograms`, `reps`/`repetitions`, `sets` — and ignores every
  word between them. Adding `for` to a list of stripped fillers would have fixed this one report and
  left `times`, `pounds` and `press` behind the same wall; this makes each phrasing work by
  construction instead. `x` and `×` need no token at all: unmatched text is skipped, so `80 x 5` and
  `80x5` both reduce to two bare numbers, which is what the shorthand means.
- **Keywords claim their number, loose numbers fill what is left, weight first.** That is what makes
  `5 reps 80` mean 80 kg and `6 reps at 60 kg` work in either order. A number followed by `sets` is
  discarded, so `3 sets of 60 for 6` no longer hands the weight slot to the 3.
- **A lone bare number still parses to nothing.** `60` is as plausibly reps as kilos, and the caller
  asking again beats logging a wrong set silently.
- **The failure message names the failure and an example** — `Didn't understand "…" — try "60 kg 6
  reps"` — and the same example sits under the button whenever it is idle. One exported constant
  (`VOICE_LOG_EXAMPLE`), so the hint and the error cannot drift from each other.

The web branch is untouched, per the Canonical Runtime rule: it feeds the same `parseVoice` and
grows no behaviour the device path lacks.

## Why the existing tests did not catch it

All seven passed, and none of them could have failed. Every case was either adjacent numbers
(`80 x 5`, `5 reps 80`) or an explicit keyword (`80 kilos 5 reps`) — the filler-word gap was
untested by construction. The measured table is now eight `it.each` rows, plus the set-count case,
the either-order case and the lone-number case. 17 tests, from 7.

## Verification

- `voice-log-parse.test.ts` 17/17; the six `components/workout` files 59/59; `tsc --noEmit` clean;
  ESLint clean on the three changed files; `pnpm check:rules` **Ran 63 of 63**.
- Driven in a browser at 412 dp on the local dev server: a real workout to the Set 1 card, where the
  Voice button renders with `Say "60 kg 6 reps"` centred beneath it, above the RPE strip and without
  shifting the button.

## Not exercised

- **The device.** The APK's native `SpeechRecognizer` path never ran — Chromium's
  `webkitSpeechRecognition` is what makes the button render in the sandbox at all, and no transcript
  was ever produced by either. **The parser was proven on strings, not on speech.** What is owed on
  the S25: say each row of the table above into the Voice button and watch the dial move, then say
  something genuinely unparseable and read the new message.
- Samsung WebView rendering of the hint line, and the tap target of the button itself (unchanged).
