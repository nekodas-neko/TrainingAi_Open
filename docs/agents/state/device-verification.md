# 📱 Device Verification — baton

> **Successor sessions are titled `📱 Device Verification Agent 🟢`** — exactly, emoji included —
> and are opened **locally** by the owner in the desktop app on the machine the S25 is plugged into.
> `create_session` makes a cloud session, which cannot reach the phone.

**Updated:** 2026-09-23 · **By:** the first-run session (`device/sweep-2-plan`) · **Next ID:** `DV-13`
(`grep -rhoE '\bDV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## For the Orchestrator — read this part

- **Assign me work with `Lane: DV`** (OR-129); I read `--lane DV` first, then `--sittings`.
- **Sweep 1 ran** (journal `2026-09-23-device-sweep-1.md`): the perf baseline (RV-137…142), the
  approved writes, RV-45 + DV-4 verified and removed. **Q-51 should be re-placed** (RV-138: no
  outlier in 90 visits). **BF-22 has device evidence** (RV-142). New: **DV-10** (A), **DV-11** (B).
- **Stale:** CLAUDE.md's `metric-log-sheet` warning (the store merges); BF-107/LA-57 still print as
  owed. DV-8's headline claims were corrected on the entry.

## Now

Nothing running; the phone is the owner's. I message him with 🔴 before the next sitting.

## Next — sweep 2, `docs/device-sweep-2-plan.md`

Eight stations (A Nutrition … H app-level), ~3 h 45 min, grouped by what one visit settles. The
per-entry detail stays in sweep 1's table. Morning-only (LB-116, TN-50), owner-present, hardware and
declined writes are listed there as out of this pass. **BF-22's next measurement** (listeners per tab
visit) rides in station H.

## Rules for every message and every input

- **Lead every message with 🟢 (phone may be unplugged) or 🔴 (plug in / leave plugged).**
- **No raw `adb shell input` outside `rawTap`/`rawSwipe`; `back()` refuses off-foreground.**
- **Wake key `keyevent 224` every 4 min; `am start` (never a tap) to front the app; `MSYS_NO_PATHCONV=1`.**

## Standing permissions from the owner (2026-09-23)

- **Writes, each undone straight after:** food, supplement tick, weigh-in (log today's own value),
  mood (overwrite allowed; restore it), activity confirm, RV-45-style throwaway create/delete.
  **Only what a check needs** — the other WRITE-ASK rows are declined. Tooling upgrades: yes.

## Decided — do not re-litigate

- **`e2e/**` does not run on the phone**; Playwright is this role's driver (`pw.js`).
- **`/api/workout-sessions/day`'s `sessionId` is the PROGRAM session**, not a workout id.
- **A request count lies for local-first screens** — read the visible number too.
- **Captures never leave this machine as images** — the repo is public.

## Claimed paths

`scripts/device/**` — mine for good (the role owns the harness).
