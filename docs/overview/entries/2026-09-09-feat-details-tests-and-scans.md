## 2026-09-09 — Tests and scans on Profile details, and the half that needs a route (BF-133, Lane B)

**What shipped.** BF-133's clinical residue: `fitness_tests`, `dexa_scans` and `measured_rmr` now
render on **More → Profile details** as a "Tests and scans" section, beneath the daily readings
#1009 added. Each row carries the day it was taken, and each group disappears whole when nothing has
been recorded — the same rule the daily half runs on, and the reason the screen does not grow a
`Blood` heading over a table that has never had a row.

**The part that decides whether this is useful or misleading is the labels.** Every number in this
section has a same-named neighbour *on the same page* that is a different measurement: the scan's
body fat against the scale's, a lab-measured resting rate against the scale's estimate, a test
morning's resting heart rate against the ring's daily figure. Each says which it is, and the
Metabolism note that used to point off-screen (*"a lab-measured RMR … is under DEXA & RMR results"*)
now points at the row above it. The VO₂max is labelled estimated, because the column is `vo2max_est`
and the test is a submaximal walk — printing it plain would present a formula's output as a
laboratory measurement.

**Two sections, not more groups in one.** The daily half returns null when it has nothing; sharing
that return would have hidden a DEXA scan behind the absence of a scale. Each half now decides its
own emptiness. The row markup was extracted to `reading-group-card.tsx` first, so this is not a
second place a metric on this screen gets formatted — the trap BF-133 names about the existing body
cards, which applies to itself.

**`personal_records` is not here, and that is filed rather than skipped.** Nothing exposes the user's
own records with a date: `repo.listPersonalRecords` returns a `Map<string, number>` that throws the
date away, and `/api/weights-summary` reports records only for the **active program**. Neither is
usable — the card's rule is that every value carries its date, and an active-program filter would
silently drop a lifetime best on an exercise no longer programmed, which is exactly what such a list
is for. It needs a route, which is Lane A's, so it is **LB-95** with `Needs: BF-133`.

**A latent race in a sibling spec, made live by three more fetches.** `measured-overview.spec.ts`
counted dated rows the moment the heading appeared — but that heading renders as soon as *either*
half has content, and the sleep average arrives from its own fetch. It read as a stable pass only
because `/api/body-metadata` happened to win; adding three fetches to the screen lost it **one run in
two**. Reproduced, confirmed pre-existing (it passes alone on clean `main` and alone with this
change — only the pair fails), and fixed by waiting for the first dated row rather than counting on
sight.

**Also recorded, from elsewhere this session.** BF-84's remaining half is gated through BF-94, which
is `Gate: device` — stated only in prose, so `next-item.js` offered BF-84 as buildable while BF-84's
own body says *"do not build the greyed second button and then have BF-94 delete it"*. Now a `Needs:`
field. And LB-56 has a **third sighting** (#1041) that names its mechanism: a browser `SIGSEGV` with
a stack trace and **no `ERR_ABORTED` at all**, which makes the two error strings previously recorded
downstream of one renderer crash rather than two faults.

**Verification.** New `e2e/details-tests-and-scans.spec.ts` seeds a scan, an RMR test and two
fitness tests of different types, and asserts the converted numbers, the dates and the qualifying
notes — **mutation-checked twice**: dropping the gram-to-kilogram conversion renders `63,400 kg` and
fails; removing the resting-HR qualifier fails the label half. The three Profile-details specs run
together **three times, 6 passed each**. 36 unit tests in `components/more/details`. `pnpm lint` 0
errors, `npx tsc --noEmit` clean, `pnpm check:rules` **Ran 70 of 70**.

**Not exercised.** The device. `fitness_tests` is read local-first and the browser has no native
SQLite, so only the `cachedFetch` fallback ran — the `getFitnessTests` branch is unexercised, and so
is how a now-noticeably longer dense list reads on the S25. Recorded as a Known-Issues row and as
BF-133's remaining `Verify: device`.

**Version.** 1.443.5 — minor user-visible addition, shipped as a patch since it is a new section on
an existing screen rather than a new surface.
