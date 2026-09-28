# 2026-09-28 — RV-78: `/api/next-session` reads its two follow-ups together

Home's most-refetched route read the stored prescription, then the muscle assignments, one after
the other. Sweep 59 noted they are not independent: the assignments were asked for the list after a
prescription's drop. They now run in one `Promise.all`, with assignments fetched for the unfiltered
list and then trimmed to the exercises that survive the drop, so the response is unchanged.

A test fails if they are serialised again: the prescription read only resolves once the assignments
read has started. The old route fails it, and so does skipping the trim. The card half of the entry
(`weight-response-card.tsx`) was dropped in sweep 59, because it is the no-local-store fallback and
does not flash on the APK.

Not measured: the saving. On this dataset it is likely a few milliseconds.
