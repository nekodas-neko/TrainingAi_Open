# 2026-08-02 — the home screen's sheets leave the initial bundle (Q-51 Task 1, partly)

_Branch `perf/home-sheet-chunks` · PR #1023 · no version bump · domain `app-shell`_

Q-51 Task 1 asked for `session-select-content.tsx` (1,414 lines) to be split, with the explicit
instruction to *"prefer moving code out of the initial chunk over merely reorganising it."* This does
the moving-out part. **It does not split the file**, and the reason is the useful finding.

## Measured, not asserted

Home route First Load JS, from `pnpm build`:

| | First Load JS |
|---|---|
| before | **326 kB** |
| after | **312 kB** |

14 kB, about 4%. Every tab route shares the number (`/more` and `/nutrition` moved identically)
because they all render the same shell.

## What moved

Seven sheets — mood check-in, morning check-in, exercise history, water log, day review, week day,
log value — went from static imports to `dynamic(..., { ssr: false })`. Each renders nothing until
its `open`/id prop says so, so their code had no business in the initial parse.

**No behaviour change.** They are still rendered in exactly the same place with the same props; only
the module boundary moved. Verified on the dev server: home renders, the mood sheet opens on tap
(body content grows), no page errors.

## The finding: 14 kB is close to the ceiling here, and that matters for the Stage 5/6 decision

The file is still **1,417 lines** — three *more* than before, from the `dynamic()` declarations. The
~800-line standing rule is still violated and this PR does not fix it.

That is deliberate, because the two goals pull apart:

- **Extracting the file's own code into `components/` children moves zero bytes.** A statically
  imported child is in the same chunk as its parent. The item says as much; it would be a
  readability change wearing a performance label.
- **The rest of the file is the visible home screen**, and `CLAUDE.md`'s instant-paint rule forbids
  making first-paint content dynamic — a loading skeleton on a cache-seeded card defeats the
  cache-seed entirely.

So the interaction-gated surfaces were the available win, and they are now taken. **Getting much
past 14 kB on this screen means either violating instant-paint or shrinking what home actually
renders** — a product change, not a refactor.

That is worth knowing before Q-51 Task 3, because the goal layout's §7 off-ramp turns on whether
cheap fixes close the gap. If ~14 kB plus the tab prefetch (#1022) does not, the answer is not "keep
splitting" — the bundle has run out of easy give.

## Not verified

Cold-start timing on device. `pnpm build` measures bytes, and bytes are a proxy for the parse/execute
cost the device profile actually implicated. **Q-51 Task 3 is still the measurement that matters**,
and it is device-only.

Splitting the file for readability remains open and is genuinely worth doing on its own terms — just
not as a performance claim.
