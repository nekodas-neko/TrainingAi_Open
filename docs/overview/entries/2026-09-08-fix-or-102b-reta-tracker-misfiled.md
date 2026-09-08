# 2026-09-08 — the reta tracker was filed as shipped and never built (OR-105)

**Branch:** `fix/or-102b-reta-tracker-misfiled` · queue fields only · no product code.

## What happened

The owner asked how the reta tracking was going. The engine half (OR-102a) had shipped —
`supplement_vials`, and `taken_at` / `vial_strength_mg` / `vial_water_ml` / `vial_units_per_ml` on
`supplement_logs`. The surface half, **OR-102b**, had not: `grep -rl vial components/ app/
--include=*.tsx` returns nothing at all. Four parts unwritten — vial setup, dose calculator, dose
timeline, weight-response chip.

It was invisible because the entry carried `- **Verify:** device`, written as *how this should be
checked once built*. `next-item.js` reads `Verify:` as **shipped**, so it printed the entry under
*"VERIFY — shipped; a look is owed, nothing is blocked"* and kept it out of READY. Lane B's READY
list held **two** items for two days while the thing the owner had asked for by name sat in the
shipped pile.

**OR-104 carried both mistakes.** The same premature `Verify:`, plus a `Gate: owner` for the owner's
hand-edit of the live `Retatrutide` row — parking the code fix that the entry's own next line said
"should not wait for it".

## Why the field rule needed a new paragraph

`Gate: device` meaning *shipped, not "will need a check when built"* was already documented, with
three prior outbreaks. This is that trap in the newer field, and it is worse rather than equivalent:
a premature gate parks an entry, and PARKED prints a reason that invites the question. A premature
`Verify:` prints **"nothing is blocked"** — so neither the implementer nor the owner has any reason
to look. The rule now says so, with the measured case attached.

## Fixed here

- **OR-102b** — `Verify:` → prose. Now **#1 in Lane B READY**.
- **OR-104** — `Gate:` and `Verify:` both → prose. Now **#1 in Lane A READY**.
- The `Verify:` field rule gains the "means SHIPPED" paragraph.
- **OR-105** filed for the rest of the class.

## Not done — and the number is not 17 defects

A scan for `Verify:` with no `Branch:` and no ship evidence returns **19 entries**; two are the ones
fixed here. **The other 17 are candidates, not findings.** BF-72, BF-95 and BF-98 were checked on the
S25 on 2026-09-06 and are genuinely shipped — they just never recorded a branch. What separated
OR-102b was a full unwritten build spec still in the body, so the long entries are the suspects:
PS-24 (56 lines), LA-57 (57), BF-119 (58), RV-40 (46). Each needs a grep against the code, which is
OR-105's job. Anyone reading the 19 as a defect count will be wrong.

**Still with the owner:** the live `Retatrutide` row is unchanged (`updated_at` 2026-09-06 20:26,
`dose` still `'10mg'`). Production is read-only from a session.

**Surfaces not exercised:** none apply — no runtime code, no device path, no schema.
