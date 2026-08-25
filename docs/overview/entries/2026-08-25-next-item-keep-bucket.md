# 2026-08-25 — the queue tool stops calling shipped work "ready" (LB-11)

**Branch:** `chore/next-item-keep-bucket` · **Lane B** · docs + `scripts/`. No product change.

`node scripts/next-item.js --lane <A|B>` is what CLAUDE.md tells an implementer to start every
session from, on the stated grounds that *"whether the top entry is actually startable is exactly
what reading the file cannot tell you"*. It was not telling you either.

## What was wrong

The protocol keeps a shipped entry in the queue when something is still owed — an owner sign-off, a
device smoke run — and it states that residue with `- **Keep:** <what is owed>`. Correct, and
deleting the entry instead would lose the obligation. But the tool had never learned to read it, so
those entries kept their **original, pre-shipping priority** and stayed at the top.

**Measured on Lane B before the change: 17 of the top 21 READY entries had already shipped.** The
first genuinely unstarted item sat below the tool's default ten-row window. Four sessions in a row
opened with a hand-scan of the backlog to get past them, which is the thing the tool exists to
remove.

## What it does now

A third bucket, **KEEP** — *"shipped; only the stated residue is owed. Not new work."* — printed
after READY with what each entry owes. Not hidden: a residue is often real work, and the script's own
principle is that an entry invisible to this query is worse than one you had to read for yourself.
Lane B's READY went **86 → 65** and its top row went from a shipped entry to a startable one; Lane A
is unaffected in shape and now leads with `TN-3a`.

`Gate:` is also read from anywhere on the Keep's lines, not only from a bullet that starts with it.
Entries write it inline — ``… its action row carries Remove. `Gate: device`.`` — and the
leading-bullet form the tool already matched covered 20 of the 27 `Gate:` mentions in the file. Those
entries move to PARKED, where they belonged.

## The parser bug worth knowing about

The colon in `Keep:` is **required**, and the first version did not require it. Without it the regex
matched prose that merely begins with the word: Q-420's `**Keep the stored field on 1–10**` — a
sentence in the middle of an owner decision — was reported as that entry's residue, while its real
`- **Keep:**` bullet sat further down. Caught by reading the tool's own output rather than by the
test, which is why the test now pins that exact pair of lines.

## Two entries corrected while doing it

Neither is a tool change; both were entries whose residue was prose the tool could not see.

- **Q-406** — its remaining call site needs a design answer (where a per-row macro-mismatch warning
  goes; none of Q-395's twelve artboards shows a warning treatment). Restated as a `Keep:` with
  `Gate: owner`, which is what it has been in fact since the day it was written.
- **Q-359** — its own body says *"the entry stays queued as the home of its ratchet, not as a queue
  of work"*, and it was ranked first for Lane B. Now says so in a field.

## Verified

- `scripts/__tests__/backlog-keep-residue.test.ts` — 7 cases, including the missing-colon defect and
  the continuation-line gate. **7 passed.**
- Ran against the real backlog for both lanes; `check-backlog-pointers` OK at 191 entries;
  `pnpm check:rules` **Ran 56 of 56**.

## Lane note

`scripts/` sits in neither lane's path list in `docs/agents/README.md` §3, and the ownership rule
(reached by `app/api/**` or storage → A; reached from `app/**`/`components/**` → B) does not decide
it either. Claimed by Lane B here because Lane B is where the mis-ranking was measured; recorded in
`docs/agents/state/implementation-lane-b.md` per the ambiguous-path rule, and released when this
merges. A future `scripts/` change by either lane is not blocked by this.

## Not exercised

Nothing to run on the device — this is a developer tool. The 33 entries carrying a `Keep:` were not
individually re-read to check that each residue is accurately stated; the tool reports what the entry
claims, and an entry that overstates what it owes will now say so in a more visible place.
