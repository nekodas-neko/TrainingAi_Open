# 2026-08-09 — The chip moved, and the latency was reasoning tokens all along

**Branch:** `fix/home-header-ring-battery-chip-crowding` · **Q-169 + Q-170, both fixed** · **v1.277.1**

Two owner decisions, answered directly. The second took three attempts, and the two that failed are
recorded here because they are the more useful half.

## Q-169 — the ring-battery chip

Owner: *"the addition of the battery has ruined the aesthetics of the home. might need to remove or
move it."* Chose **move to the icon cluster**.

It was a percentage pill sharing the date line with the date and the weather chip, competing for
width against the fixed right-hand icon row. It is now an icon in that row: the glyph itself changes
by level (full / medium / low / warning / charging), so the state is **not colour-only**, and the
percentage moved into the `title` and the accessible name rather than being dropped.

Verified at 412×891 in both themes with a battery reading mocked in: identical position, 28×44,
date line clear. `levelColor` went with the percentage span — nothing else used it.

**The implementer who shipped this chip flagged exactly this risk as unverified, and it
materialised on a real device.** That note is why the fix took ten minutes instead of a
reproduction hunt.

## Q-170 — latency: 10.0 s → 3.5 s, once I stopped guessing

Owner chose "do the full latency work". **My first two attempts were guesses at where the time went,
and both made it worse.** The token log answered it in one query.

### The measurement that settled it

`ai_call_log`, two turns:

| turn | input tok | **output tok** | latency |
|---|---|---:|---|
| picker, 9 options | 10,832 | **2,204** | 10.0 s |
| short text answer | 9,636 | **348** | 3.1 s |

Two points, one line: **~1.8 s fixed overhead, then ~270 output tokens/sec.** Latency is output
generation and essentially nothing else — not prefill, not the tool round trip, not grounding.

Then the part that mattered: a 9-option choice list is about **400 tokens** of actual JSON. So
~1,800 of those 2,204 tokens were **reasoning the user never sees**.

### The fix

One line — `thinkingConfig.thinkingLevel: 'minimal'` on the Coach route. The same turn drops to
**554 output tokens and 3.5 s**. Five-run wall clock: **2.2 / 2.5 / 2.7 / 3.4 / 3.4 s**, against a
baseline median of 8.2 s.

Quality was checked on the hardest flows rather than assumed:

| flow | result on `minimal` |
|---|---|
| three-turn swap | list → `findSwapCandidates` → correct `proposeChange` |
| create-an-exercise | correct patch, `Hamstrings, Lower back` + `Barbell` |
| "how has my push progression been" | six tools chained, real numbers, **4.0 s** (was 10.6 s) |

`low` is the fallback if a regression turns up — 1,305 tokens / 6.5 s.

### The two dead ends, kept on purpose

**Inlining the program into the system prompt.** The `getProgramStructure` round trip genuinely
disappeared, and the turn still came out ~1.1 s *slower* (9.7 s vs 8.6 s mean): a bigger prompt on
every turn costs more than the call it saves. `lib/coach/program-brief.ts` was written, measured and
deleted.

**A sentence before every tool call.** First text at ~4.2 s instead of ~9 s, but the widget slipped
to ~12 s. Earlier reassurance is not worth a later button.

Both are recorded in the backlog with the numbers, so the next session does not re-derive them.

### The lesson

Wall-clock alone cannot tell reasoning from generation. **Measure the output-token count before
optimising an LLM route** — the two failed attempts cost more time than the fix did.

## Verification

426 files / **3425 tests** green · lint + all 15 custom-rules scripts pass · header screenshots in
both themes · every latency and token figure above read from `ai_call_log` on the local dev server.

**Not exercised: device.** The chip's new position was verified at the S25 viewport in a desktop
browser, not on the S25. Latency was measured dev-server-against-local-DB; production will differ,
though the token counts that drive it will not.
