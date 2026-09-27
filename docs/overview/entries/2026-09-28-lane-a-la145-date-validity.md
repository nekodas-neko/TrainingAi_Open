# 2026-09-28 — LA-145: every date field that checked a shape now checks for a real day

A date regex accepts `2026-02-31` and `2026-13-01`. Both then reach a `date` column and fail at the
driver (`22008`) as a bodiless 500. LA-145 counted 25 files with the shape regex and 9 with a
validity check, and said the fix was per-file triage, not a sweep.

## Triage, re-measured on `main` today

26 files carry the shape, 16 check validity. Of the other 10:

| file | outcome |
|---|---|
| `admin/timing-baseline`, `dexa-scans`, `measured-rmr` routes | `.refine(isCalendarDate)` on the field |
| `validation/injury.ts` (`startedDate`, `resolvedDate`), `validation/supplement.ts` (window date → `startedOn`/`stoppedOn`) | same |
| `sentry-scrub.ts`, `sync-health`, `health-connect-ingest` | false positives, as the entry said: redaction, and two routes that validate through an import the grep cannot follow |
| `water-log` | **false positive, not in the entry's list**: it accepts a client date only when it equals today or yesterday, both real days, and falls back to today otherwise |
| `validators/chat.ts` | **dead**: nothing has imported it since Q-189 deleted the route. Deleted, along with `validators/tts.ts` beside it, which was dead the same way |

`plan-meal-answers`, in the entry's list, had been fixed since.

## Verification

- Each of the three routes has a new case: an impossible day gets 400 and never reaches the
  repository (`2026-02-31`, `2026/02/30`, `2026-13-01`). The shared fields have a test asserting the
  same, and that real days in both separators (and 2024-02-29) still pass.
- **Mutation pass: removing the refine from each of the five files is killed.** The control (changing
  the error message) survived.
- `pnpm dev` over HTTP: `dexa-scans`, `measured-rmr` and `admin/timing-baseline` return 400 for
  `2026-02-31` and 200 for a real day; timing-baseline still accepts `null` to clear;
  `POST /api/injuries` with an impossible `startedDate` returns 400.
- `docs/module-map.md` named the two dead validators as the validators; it now names the live ones.

## Not exercised

The device. These are server-side validation changes, delivered by the Railway deploy.
