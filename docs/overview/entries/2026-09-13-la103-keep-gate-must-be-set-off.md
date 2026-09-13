# 2026-09-13 — the measurement refuted the fix the entry proposed (LA-103)

**Branch:** `lane-a/la103-keep-gate-prose` · one parser, one new test file, backlog + journal. No
product code, no user-visible change, no version bump.

## What was wrong

`scripts/lib/keep.js` read a `Gate:` from **anywhere** in a `Keep:` block. BF-46's Keep contained the
sentence *"**The `Gate: device` above was deliberately withheld while they were unbuilt**"* — a
sentence **denying** a gate — and it was parsed as asserting one.

It hid for weeks because `next-item.js` skips a Keep's gate when the entry also carries `Verify:` for
the same value. The owner's 2026-09-13 nutrition pass verified BF-46 on the S25, which correctly
removes the `Verify:`; that un-masked the phantom, put a VERIFIED entry back into PARKED, and turned
`main` red on every branch. The red was cleared that morning by rewording the sentence (#1137); this
is the parser half it deliberately left.

## The entry proposed a discriminator, and measuring it proved it wrong

LA-103 wrote down a hypothesis from the single BF-46 case — *a mention preceded by a word character
is prose* — and then said, in its own text, that one case is not a population and the entry must not
be built on it. That instruction earned its place.

**Measured across all 164 Keep blocks: 18 yield a gate. LB-53 refutes the hypothesis outright** —
*"running it is a **`Gate: owner`** action"* is preceded by the word "a" and is a real gate that
parks real work. Seventeen of the eighteen follow a full stop; LB-53 and BF-80 are bolded.

**What actually separates them is whether the token is SET OFF from the prose** — it opens a clause,
or it is emphasised — versus sitting inside a sentence. That is `GATE_IS_SET_OFF`: look at what
precedes the token, after an optional backtick, and accept nothing, a clause boundary, or `**`.

Scanning per **line** rather than over the joined block, so a bare `Gate: device` opening a
continuation line is set off by the line break instead of hiding behind the previous sentence's last
word.

## What did not get built, and why that mattered

**Anchoring the regex to a bullet start** — the obvious fix, and the one the entry explicitly warned
off — **would have dropped all eighteen and silently un-parked genuinely blocked work.** That is
worse than the bug it fixes: the bug parks one finished entry loudly, the fix would release eighteen
unfinished ones quietly. It is pinned as a killed mutant rather than described.

## Verified

- **The rule is fitted to nineteen observed cases, so the real file is what protects it, not the
  reasoning.** The classification of `docs/implementation-backlog.md` is asserted **by id**, all
  eighteen, and it is byte-identical before and after the change.
- **Mutation pass: three mutants, all killed** — reading a gate from anywhere (the original defect),
  dropping the bold branch (loses LB-53 and BF-80), and anchoring to a bullet start (loses all
  eighteen). One deliberately equivalent control, `trimEnd()` rewritten as a regex, survived.
- Eight tests in `scripts/__tests__/keep-gate-set-off.test.ts`, plus the existing
  `backlog-verify-field.test.ts` re-run to confirm the PARKED/VERIFY/KEEP split is untouched.

**Not exercised:** nothing device or runtime — this is a backlog parser and its tests.

## Worth carrying

**An entry that records its own hypothesis as a hypothesis is what made this cheap.** LA-103 could
have said "anchor the regex" and been implemented in one line, wrongly. Instead it named the
discriminator it suspected, said it was drawn from one case, and demanded the population be measured
first. The measurement took ten minutes and changed the answer.
