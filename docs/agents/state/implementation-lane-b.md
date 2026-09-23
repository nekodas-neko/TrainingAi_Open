# Implementation Agent (B) — baton

**Updated:** 2026-09-23 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-130 (LB-129 filed 2026-09-23; check the JOURNAL as well as the backlog — a shipped
entry is removed from the queue, so the backlog alone under-counts).

## Now

#1449 (DV-4, sleep legend contrast, v1.465.10) open, five required green expected ~05:01.
Shipped before it: #1431 (RV-110 + RV-112), #1422, #1425.

## Next

`node scripts/next-item.js --lane B` — **run it, do not trust a note, including this one.** I
planned BF-177 as next from memory; the runner put it at position **17**. Queue position is
priority and only the runner knows it.
Head after #1449: DV-6 (status-bar scrim — owner decided a GRADIENT, in the shell once, fading in
on scroll; gate released, no mockup owed; its entry carries three findings that cost an hour to
get), then LB-129, RV-113, RV-114, RV-115, then `home-ia-merge` and `health-ia-merge`.
**RV-117/118/119 carry `Owner gate SATISFIED 2026-09-22`** — build to the mockup. RV-116 was
NARROWED to picker copy only; re-read it.

## Blocked / owed

- Device checks are the **Device Verification** agent's to RUN; mine only to RECORD, as
  `Verify: device` + a `Keep:` naming it — that pair is what `--sittings` keys on, and it keeps the
  entry out of READY without deleting it. A FAILED check comes BACK as work.
- Owed: an e2e that discriminates shell-teardown from shell-flip (RV-110's premise is unverified),
  and LB-129's cause.

## Claimed paths

None.

## Lessons that cost real time

- **Start from the runner, not from your own plan.** See Next. Same class: re-read the entry before
  building — DV-4's prescribed fix changed shape once all four `STAGE_COLOR` consumers were read.
- **Probe before sweeping, and check the negative case.** A source-read said `useSearchParams`
  cannot see a tab flip; measured, false — it would have cost a shell rework plus 37 files. The e2e
  written to prove the premise marked `<main>`, which never unmounts, so it passed regardless.
- **Run the FULL vitest suite before pushing, never scoped to the dirs you changed.** Cost a red CI
  on #1431: a source-shape test two directories away asserted on the file I converted.
- **Never pipe a gate through a short `tail`.** Hid two merge conflicts and a ratchet failure.
- **`total_count: 0` is a CONFLICTED PR, not slow CI** — GitHub gives a conflicted tree no workflow
  run at all. Check `mergeable_state`; `dirty` means re-merge. Distinct from the shallow graft in
  CLAUDE.md, which fakes the same symptom — `git fetch --unshallow origin` EVERY time, and re-check
  `test -f .git/shallow`, because a plain fetch re-grafts.
- Re-merge `origin/main` before opening a PR *and* before merging; `main` landed one every ~5 min
  on 2026-09-23, and #1431 needed seven merges.
- **`.size` conflicts are largely gone** — RV-134 landed 2026-09-23 and tolerates slack within
  `max(25, 2%)`, so only real GROWTH needs a baseline edit. Run the check before `--fix`.
- `session-select-content.tsx` is a size-ratcheted hotspot: put reasoning in a sibling file and
  leave a one-line pointer.
