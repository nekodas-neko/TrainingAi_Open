# Review sweep 54 — reading the instruments, 2026-09-23

**The angle, and why it is new.** Sweeps 50–53 all read source code. This one reads what the app and
its guards have already *recorded* — production `error_events`, the database's own size counters, and
the shrink-only ratchets' baselines — and asks whether anyone has acted on what they say. Findings
here are measurements rather than inferences, which makes them cheap to check and hard to argue with.

It found two things that are the same shape: **an instrument gave its answer, and the document that
tells people what to do still states the question.**

---

## RV-135 — BF-110's reading arrived five days ago and its own `Keep:` still says it is waiting

`lib/resume-repaint.ts` shipped a measurement pass on 2026-09-14 to settle one question, and wrote
the criterion into its own header:

> *"If the height reads 826 half a second later, the viewport was always going to resize and the bug
> is in when the app decides to render — a JS fix. If it still reads 667, the viewport is genuinely
> stuck and the fix is in the native layer. **Those are different files, which is why this ships
> before any fix.**"*

Measured across the full retained window:

| verdict | rows |
|---|---:|
| `recheck stuck` | **25** |
| `recheck resized` | **0** |
| `dom-lost` | **0** |

Twenty-five for one answer and none for the other. **The fix is native.**

BF-110's body already says so — sweep 50 filed the reading on 2026-09-18 under a `✅ THE READING IS
IN` heading. **Its `Keep:` line, further down, still reads** *"the READING, and only that … Still do
not write a fix before that row exists."* `next-item.js` reads the `Keep:`, not the body, so the
entry sits in the **KEEP** bucket — *"shipped; only the stated residue is owed. Not new work."*

So an implementer scanning either lane sees an entry labelled not-new-work, waiting on a row that has
been in the table for five days. The analysis is right and the filing hides it.

**It has not gone quiet.** `stuck` at `h=667` went 3 → **9** since sweep 50; first readings at
`h=667, children≤2` went 22 → **28**. At 384×667 the shell renders 1–2 children where a healthy
resume at 384×826 renders 6–8 — so the blank resume is roughly twice a day and continuing.

**`dom-lost` has never fired in 62 reported resumes.** BF-80's renderer-death is disproven for every
sample taken; the compositor reading is the one left standing.

---

## RV-136 → fixed in this PR rather than queued: CLAUDE.md's fetch-once numbers were 19 wrong

The cache-invalidation rule — the project's most repeated bug class, in the most-read file in the
repo — said:

> *"`check-fetch-once-effects.js` freezes the 36 remaining sites: **19 are permanently mounted and
> can bite**, 1 is a deliberate warm pass, 16 unmount and are latent."*

The script's own baseline says **11 sites across 9 files**, every one tagged `route`, `conditional`
or `inside a sheet` — and:

> `// ── CAN BITE: permanently mounted, so nothing ever remounts them to refetch. **0 sites.**`
> `// Emptied 2026-08-19.`

**The rule had been wrong for five weeks**, since the scanner's over-counting was corrected in the
script (25 across 16 were really 15 across 12; the can-bite group was two sites, not eight; both were
then converted). Corrected in place rather than filed — a wrong number in the file every session
reads first is worth one commit, not a queue position.

**This corrected one of my own entries too.** RV-125, filed three hours earlier in this session,
opened by quoting the stale 36/19 split and calling it *"reasoned, never observed"* — which was
itself wrong: it **was** re-observed, on 2026-08-19, and the observation is what emptied the group.
RV-125 is amended. **Its premise survives**: the script skips any non-empty dep array by design
(`:164`), so it still cannot see `useEffect(…, [userId])` inside a shell where `userId` never
changes — and the baseline confirms it from the other side, having dropped `workout-screen`'s two
sites for exactly that reason. The count was wrong; the blind spot is real.

---

## Measurements taken and found healthy — recorded so a later change has a baseline

- **Database: 232 MB** (2026-09-23), against **227.4 MB** on 2026-09-20 — **1.53 MB/day over three
  days**, at or just under the standing ~1.71 expectation. No Known-Issues row owed. The falsifiable
  prediction in `CLAUDE.md` is unchanged: a step down when `rr_intervals` reaches its 90-day cap in
  late October, and another when `oura_heartrate` reaches 180 around 2026-12-19, settling near
  ~0.96 MB/day. **A step that does not arrive is the signal.**
- **`error_events`: 52 MB behind 172 live rows.** Unchanged in size since 2026-09-18, when it was
  52 MB behind 115. Still bloat rather than payload, still a `VACUUM FULL` question, already filed
  and owner-gated. Not re-filed.
- **No fault of the owner's in seven days that is not `bf110 resume`.** Every one of the 24 grouped
  rows is that one marker. Written as *"none of the owner's"* deliberately — `claude_ro.error_events`
  is row-scoped to one user, so this endpoint structurally cannot say that nothing else is failing.
- **The other shrink-only ratchets are clean and their baselines are not stale**:
  `check-component-size` (no file over 800 lines beyond 4 recorded hotspots), `check-hex-literals`
  (409 across 77 recorded files), `check-aest-midnight-timezone` (**0**, against an empty baseline).

---

## Not established

Nothing was rendered, reproduced or run on a device. The `error_events` reads are production and
real; everything said about *why* a 384×667 resume renders two children rather than seven is the
module's own reading of its own data, not an observation of the screen. **That observation is what
RV-130 asks the device agent for**, and it is the probe this sweep would most like back first.
