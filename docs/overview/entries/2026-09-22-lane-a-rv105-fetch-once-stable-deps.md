# 2026-09-22 — the fetch-once ratchet could only see an empty dep array; now it sees the shell-stable ones

**Branch:** `lane-a/rv105-fetch-once-stable-deps` · **Agent:** Implementation (Lane A) ·
**Code + docs.** Tooling only — no app behaviour changes, so no version bump.

`check-fetch-once-effects.js` gated on `}, [])` and nothing else. Its comment gave the reason:
*"a non-empty one re-runs when its deps change, which is a different (and usually correct) shape."*
True in general, false inside the persistent tab shell, where `[userId]`, `[tz]` and `[today]` never
change either — so those effects re-run never, and the component holds its first payload until the
app is killed. That is the Q-402 shape this ratchet exists to catch.

**⛔ The entry says "four of the five freshness findings are that shape". Two are.** Checked after
the fact, prompted by a Review Agent note that listed a different four: **RV-106**
(`hr-day-card.tsx:39`, `[today]`) and **RV-109** (`activity-history-card.tsx:72`, `[userId]`) are
this shape and the widened check does find both. **RV-104 and RV-107 are not, and cannot be**
without undoing an earlier correction — both are `nutrition-content.tsx:318`,
`useEffect(() => { fetchMountData(); }, [fetchMountData, userId])`, where the fetches live in a
`useCallback` and the effect body contains no `cachedFetch` at all. That is the exact shape the
script's header records as deliberately excluded: counting it is what inflated the baseline by 11 of
25 in the first version, and `health-content.tsx` carried a baseline of 2 with no fetch-once effect
in it. So the widening is worth doing for two real findings, not four — and the number mattered
enough to check, because "four of five" is the entry's whole argument for urgency.

## The entry's open question, answered with a scan

It said the four were *"found by hand, not by a candidate scan"* and that the number of new sites was
not established. Scanned, reusing the script's own brace-matching so the counts are comparable:

| dep shape | count |
|---|---:|
| `[]` — what the check saw | **11** |
| stable-only (`userId`, `tz`, `today`) | **+14** |
| any other dep — still invisible, correctly | 40 |

Widening **more than doubles** the tracked population, 11 → 25 across 20 files. That is the fact
that reframes this as a re-baseline rather than a one-line tweak, and it is why the baseline block
carries the new sites grouped by what they are instead of appended as a flat list.

## Where the entry contradicts itself, and which half is right

Its diagnosis names `[userId]`, `[today]` **and `[trendsProp]`** as deps that never change. Its
*Fix, narrowly* lists only `userId`, `tz`, `today` — no `trendsProp`. Three sites turn on it.

**The narrow list is right.** `trendsProp` is a prop the parent resolves from `undefined` to a value,
so it genuinely changes — `oura-section.tsx` carries a second effect whose entire job is to adopt it
when it lands, and the fetch-once effect guards on `trendsProp !== undefined`. Counting it would
flag three sites that are already handling the change correctly. It is excluded, with the reason in
the code rather than only here.

## What this change does NOT do

**It widened the lens; it did not audit what the lens revealed.** All 14 predate it, so none is a
regression, and every one went into the baseline rather than being converted. Two groups are called
out in that block rather than left to look uniform:

- **`sync-provider.tsx` is 4, and is deliberate** — the warm pass the header already describes as a
  sanctioned exception. It was recorded as *one* site in the 2026-08-19 correction, which was
  looking only at `[]` deps and could not see these. Converting them would add refetches with no
  reader waiting.
- **`workout-screen` still needs judging by where it MOUNTS.** It is not one of the five tab
  screens, so it plausibly unmounts — and "plausibly" is precisely the reasoning that group has
  been got wrong three times.

**Two of the fourteen are already gone, and that is the check working.** `hr-day-card` and
`activity-history-card` went into the baseline here; Lane B converted both in #1422 while this
branch sat open, and on the first run after merging `main` the shrink-only rule **failed the check**
and demanded their rows be deleted. Both were `[today]`/`[userId]` deps — invisible to the
`[]`-only gate, which is why RV-106 and RV-109 had to be found by hand. The baseline is now 23
across 18 files rather than 25 across 20.

RV-104, RV-106, RV-107 and RV-109 have all since shipped (#1416, #1422), so the four findings that
motivated this entry are fixed. The gate's value from here is the next one, not those.

## Verification

- **Mutation-checked in both directions**, as the file's header records was done for the brace
  matching: a new site with `[userId]`, with `[]`, and with `[userId, tz]` each fail the check; a
  site with `[date]` (the `week-day-sheet.tsx` counter-example the entry names), one with
  `[trendsProp]`, and one with stable deps but no `cachedFetch` each pass. Six cases, all as
  intended.
- The empty-array case is a **special case** of the new test rather than a branch beside it
  (`[].every(...)` is true), so the original behaviour cannot drift away from it.
- `pnpm check:rules` **75 of 75** · `check-comment-blindness` 11 passed (it carries a fixture for
  this check) · the check itself reports **25 known across 20 files, none new**.

**Not exercised:** no app code changed, so nothing was run on `pnpm dev` or on device. The regex
window grew from 30 to 200 characters to fit a dep list; a dep array containing a nested `]` still
fails to parse and is skipped, which errs toward under-counting rather than over — the safe
direction, and the same one the 2026-08-19 correction was cleaning up after.
