# 2026-08-25 — the ratchet row that kept a fixed file exempt (Q-138)

**Branch:** `fix/component-size-stale-baseline` · **Lane B** · one script, one backlog table.
No product change, no version bump.

## Found by re-measuring a table, not by reading code

Q-138 lists six component-size hotspots with concrete extractions and says — correctly — *"take them
opportunistically when already touching the file, not as a dedicated PR."* That instruction was
respected. What the entry does not say is that **two of its six rows were already done**:

| file | entry says | actually |
|---|---:|---:|
| `app/health/health-content.tsx` | 991 | **651** |
| `components/more/profile-tab.tsx` | 849 | **476** |
| `components/workout-screen.tsx` | 1851 | 1820 |
| `app/session-select/session-select-content.tsx` | 1478 | 1456 |
| `components/config-screen.tsx` | 997 | 997 |
| `components/config/program-editor-sheet.tsx` | 963 | 963 |

Both finished files are **under the 800-line limit**, and their proposed extractions cite line ranges
that no longer exist — `health-content`'s row points at lines 588-779 of a file that is 651 lines
long. **A stale row is worse than no row**: it sends the next reader somewhere specific and wrong.

## The hole underneath

`app/health/health-content.tsx` was still in `check-component-size.js`'s `BASELINE` at **915** while
sitting at **651** — silently re-granting it **115 lines** of room it was no longer entitled to.

The script's own header has said *"Shrinking one below the limit? Delete its row — it is then held to
LIMIT like everything else"* since it was written. **Nothing enforced it**, and the rule has now been
missed three times: `health-sections.tsx` was removed correctly on 2026-08-09, then `profile-tab.tsx`
sat listed at 476 and `health-content.tsx` at 651. `CLAUDE.md` records the first two and reads as
though the habit held; it did not.

`check-client-today-timezone.js` has enforced exactly this for its own baseline all along — *"BASELINE
is shrink-only and these files have improved — lower them in the same PR, so the reclaimed ground
cannot be given back silently."* This is that half, arriving late in the sibling that needed it.

## What shipped

- `health-content.tsx` removed from the baseline. Four hotspots remain, all genuinely over the limit.
- A stale-row check: any `BASELINE` entry whose file is now at or below `LIMIT` — or has been deleted
  — fails, naming the row and its current size.

**Deliberately narrower than its sibling.** The timezone check fails whenever a listed file merely
*improves*; doing that here would fail CI on a routine refactor that trims thirteen lines off a
1,833-line hotspot, which is noise, not a finding. The rule enforced is only the documented one — a
row for a file no longer over the limit — which is the case that was actually missed three times.

## Verified

- `check-component-size` → *"no .tsx file over 800 lines beyond the 4 recorded hotspots"*, exit 0.
- **Proved the guard fires**, which is the only thing that makes it worth anything: a probe row
  claiming a 900-line baseline for `components/ui/sparkline.tsx` (68 lines) reports
  *"BASELINE holds file(s) that are no longer over the limit"* and names it. Probe removed.
- `pnpm check:rules` **Ran 56 of 56** · `check-backlog-pointers` OK at 194 entries.

## Not exercised

Developer tooling; nothing rendered changed, nothing device-related. **The four remaining extractions
were not done** — Q-138 says to take them opportunistically when already in the file, and that stands.
