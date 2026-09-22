# 2026-09-22 — `chore/or-122-ungate-unbuilt-work` (OR-122)

**Orchestrator.** A read of the queue for what could be combined or unblocked. It found two circular
parks and one detector bug, and the three turned out to be the same shape.

## The state that prompted it

`next-item.js` reported **Lane A 21 READY, Lane B 0**. Lane B was not out of work — 38 KEEP,
48 PARKED, nothing startable.

## Five entries parked by the wrong field

`Gate: device` means **shipped, awaiting a look**. Five entries used it to mean *"this will need a
device at the end"*, which parks unbuilt work.

- **RV-68**, **RV-74** — unbuilt, filed 2026-09-20, both gated. RV-68's fix is three statements
  moved above a `try`; RV-74's is one CSS transition. Now plain **Verification** lines.
- **BF-165** — a **live owner-reported bug** (*"when I try click the treadmill… nothing actually
  happens"*), root cause fully measured, design constraints written out, and gated since
  2026-09-17 with the exit condition *"ungate it the moment the fix lands in a branch needing only
  the S25 look"*. A gated entry never prints as READY, so nobody starts the fix, so the condition
  cannot arrive. Ungated and added to the `back-gesture-sitting` batch, which needs the same
  Android back gesture it does.
- **LB-116** — shipped, owes a check → `Verify: device` (which does not park), per BF-90.
- **BF-111** — shipped, then **FAILED on the S25**. A device gate there describes debt that is
  settled and hides what is actually blocking: the owner's screenshot, because a bare fail does not
  say which of the card's three states was wrong. Re-gated `Gate: owner`.

## LA-49 was parked by the bug it describes

The deeper cause. `next-item.js` treated **any `⛔` in an entry body** as a blocked marker. Measured
today: **28 entries parked by it, ~7 meaning blocked.** The other 21 use `⛔` as an emphasis glyph
for a warning to whoever *builds* the entry — *"⛔ Do not extend this to the conic-gradient rings"* —
which is the opposite of a reason not to build it.

**LA-49 measured exactly this on 2026-09-01 (34 entries, 7 real) and specified the fix in two
ordered steps. It then sat for three weeks — because it quotes three of those emphasis markers as
evidence, so the detector parked it too.** Nothing about the measurement decayed; it never printed
in a READY list.

Both steps shipped here, in LA-49's own order, because its caution was correct — narrowing the
detector first would have put two entries whose headings open *"REFUTED"* at the top of an
implementer's work list.

1. **Triage.** The genuinely blocked got fields: `Gate: owner` on **TN-2** (the `.constants.json`
   set Q-49 removed from the repo does not exist in a container), **Q-49**, **Q-72**, **Q-85**,
   **Q-1b**; `Needs: BF-92` on **Q-252**. **Q-538**'s bound was *"blocked, and not by anything in
   this queue"* — it had no target to point a `Needs:` at, so **OR-123** was filed for the WebView
   rollup consumer and Q-538 now needs it. The refuted ones — **BF-14**, **LA-57**, both of which
   say outright *"do not implement"* — got `Reference:`. **Q-48** was parked by a glyph inside a
   struck table row whose whole content is that the block was released; the glyph is elided from
   the quotation now, with a note saying why.
2. **The detector** now matches `⛔ block…` rather than the bare glyph — the file's own documented
   convention (`⛔ blocked: <reason>`), not a new heuristic.

**Result: Lane A 21 → 33 READY, Lane B 0 → 4.** LA-49's verification criterion holds — no entry in
READY has a heading saying it is refuted, shipped or superseded. Three entries still park on the
narrowed marker, all correctly.

## Worth carrying

**Two circular parks in one read, with one shape: a condition for becoming visible that can only be
met by someone who can already see it.** BF-165's gate could only be lifted by work the gate
prevented starting; LA-49 could only be fixed by an implementer the bug hid it from. When writing a
park of any kind, check that something *outside* the entry can lift it.

And the narrower rule it is an instance of: **`Gate:` is for what blocks starting. Unbuilt work
gets a Verification line, however certain it is that the device will be needed at the end.**

## Not done

- **47 device checks are still unbatched** (68 owed, 21 in the seven existing batches). Clustering
  them by the screen each needs is the next aggregation pass, and it is the one that costs the
  owner's attention rather than CI.
- The `legacyBlocked` code path was **narrowed, not deleted** — LA-49's step 2 said to delete it.
  Q-1b's `⛔ blocked because` is a real marker doing real work, so the path stays.
