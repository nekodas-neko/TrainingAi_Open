# Implementation Agent (B) — baton

**Updated:** 2026-09-23 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-130 (LB-129 filed 2026-09-23; check the JOURNAL as well as the backlog — a shipped
entry is removed from the queue, so the backlog alone under-counts).

## Now

Nothing in flight. Last shipped: #1422 (RV-106/107/109), #1425 (RV-135), and the `tab-nav-shell`
PR (RV-110 + RV-112). Start from `node scripts/next-item.js --lane B` — do not assume the top item;
RV-135 arrived as a surprise #1 on 2026-09-23.

## Next

Queue head after `tab-nav-shell`: RV-113 (tab switch is a hide-then-fade), RV-114, RV-115, then the
batches `home-ia-merge` (RV-116 + RV-119) and `health-ia-merge` (RV-117 + RV-118). **RV-117/118/119
carry `Owner gate SATISFIED 2026-09-22`** — build to the mockup; a departure needs a fresh yes.
RV-116 was NARROWED to picker copy only; re-read it rather than the original.

## Blocked / owed

- Device checks are the **Device Verification** agent's to RUN; mine only to RECORD. A `Keep:`
  naming the device is what `next-item.js --sittings` keys on. A FAILED check comes BACK as work.
- Owed specs: an e2e that actually discriminates shell-teardown from shell-flip (RV-110's premise
  is unverified — see its journal entry), and LB-129's cause.

## Claimed paths

None.

## Lessons that cost real time

- **Probe before sweeping.** A source-read said `useSearchParams` cannot see a tab flip (raw
  `replaceState`, LA-109's stale tree). Plausible, false — measured, the param arrives at first
  mount AND on a flip into a mounted tab. It would have produced a shell rework plus 37 files on a
  false premise. Reproduce before asserting, and again before building.
- **A green spec can be vacuous.** The shell-survival e2e marked `<main>`, which lives outside the
  tab panels and never unmounts, so it passed regardless. Always check the negative case — and make
  sure the negative control actually does the thing (mine dispatched a non-tab href, which
  `onNav` ignores without `preventDefault`, so nothing navigated).
- **Run the FULL vitest suite before pushing, never a subset scoped to the dirs you changed.**
  That cost a red CI on #1431: `lib/__tests__/activity-store-stale-setup.test.ts` is a
  source-shape test asserting on `components/guided-walk/walk-summary.tsx`, so converting that
  file broke a test two directories away. Source-shape tests live anywhere and assert on anything.
- **Never pipe a gate through a short `tail`.** It hid a second merge conflict twice and a
  ratchet failure once in one night.
- **A conflict left inside a `.size` file makes `check-doc-index-size.js` THROW, not fail cleanly.**
  Resolve with `sed -n '4p' <file>` to take origin/main's side, then `--fix`.
- **`.size` conflicts on every re-merge are RV-134 (`Lane: O`), not mine** — 4 of 4 on one PR.
- Re-merge `origin/main` before opening a PR *and* before merging; `main` landed a PR every ~5 min
  on 2026-09-23. ⛔ `refusing to merge unrelated histories` = shallow graft → `git fetch origin
  --deepen=200` FIRST, and `git fetch origin main --force --prune` (a plain fetch leaves it stale).
- `session-select-content.tsx` is a size-ratcheted hotspot: a multi-line comment pushed it over.
  Put the reasoning in the sibling file and leave a one-line pointer.
