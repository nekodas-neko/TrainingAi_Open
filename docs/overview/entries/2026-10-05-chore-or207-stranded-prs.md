# 2026-10-05 — OR-207: three of six landed, one held, two found obsolete

**Branch:** `docs/or207-stranded-prs` · **Lane A** · docs only.

Merged `#2024` (LB-194), `#1902` (TN-56, flipped from draft; the owner's yes is on LA-173) and `#1847`
(LA-159). `#1847` merged eight minutes after OR-207 gained a hold on the column-dropping migrations
during a device sitting, and Lane A had not re-read the entry before arming auto-merge. That is
recorded on the entry, with the practice that follows: a migration PR is merged by hand, never armed.

`#1849` (LA-142) is ready and **held** with auto-merge disabled. `#1790` and `#1762` were checked
against `main` and are obsolete, so closing them is put to the owner on the entry. Nothing in this PR
touches code.
