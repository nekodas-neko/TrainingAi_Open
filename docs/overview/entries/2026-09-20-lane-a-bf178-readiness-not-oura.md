# 2026-09-20 — BF-178: the readiness number is ours, and three surfaces said it was Oura's

**Branch:** `lane-a/bf178-readiness-not-oura` · **Lane A** · owner report: *"Still called oura
readiness"*, on the *Why Upper?* screen.

## What was wrong

`liveReadinessForDay` returns `oura_daily_derived.readiness_score` where
`readiness_source === 'ble-derived'` — the app's own composite. The frozen Oura Cloud column is a
fallback **only** for pre-re-key days, gated on `isPreRekey(date)`. The header of
`live-readiness.ts` has said so since it was written. Three live surfaces still printed the number
as Oura's:

| site | said |
|---|---|
| `packages/shared/src/session-explain/group-signals.ts:47` | `label: 'Oura readiness'` |
| `packages/shared/src/health/weekly-digest-metrics.ts:111` | `Oura readiness: N/100 avg that week` |
| `app/api/session-explain/insight/route.ts:46` | prompt line `- Oura readiness: …` |

Home calls the same value **"Readiness"**. One tap apart, same number, two provenances implied, and
the Oura one false.

## What shipped

All three now say **"Readiness"**, matching Home rather than inventing a fourth vocabulary.

**The prompt line is the half that mattered** and the reason this is a bug and not a quibble: it
fed the model `- Oura readiness: 46`, so the generated prose said it too — the owner's screenshot
reads *"Despite your Oura readiness of 46"*. A label is a rename; a prompt line teaches the model
to attribute the app's own composite to a third party in text the owner reads as fact.

Its `'not connected'` fallback went with it, to `'no data'`. "Not connected" describes a
third-party device that could be disconnected; when the value is ours it is simply absent.

**The field is still `ouraReadiness`**, now carrying a comment in `types/program.ts` and
`build-explain-data.ts` saying the value is ble-derived. The name is what taught all three call
sites to write "Oura", so leaving it uncommented would re-teach the next one. Renaming the field
touches five more files and is a mechanical change; bundling it into a behavioural fix would have
made the diff harder to read for no gain. Not filed as follow-up work — the comment removes the
trap, and a rename with no defect behind it is churn.

## What was deliberately left alone

- **`lib/health/readiness-payload.ts:749`** — *"An Oura readiness score is a whole-picture number
  by construction"* is guarded by `ouraToday?.readinessScore != null`, i.e. the real Cloud column.
  That comment is correct about what it describes. **It did raise a separate question worth
  recording: that availability branch still reads the frozen Cloud column, which post-re-key is
  absent for every recent day.** Out of scope here and not investigated.
- **`packages/shared/src/types/day-checkin.ts:67`** — design provenance for the Recovery scale.
  History, not a live label.
- **`changelog.ts`** — a changelog entry describing what shipped then is accurate as a record.
- **`score-ring.tsx:8`** was updated, because it *quotes the screen* (*"signals reading Oura
  readiness 37 · Low"*) and the quote had just gone stale. One word; the argument it makes is
  about HIGH-above-Low and is untouched.

## Verification

`packages/shared/src/health/__tests__/bf178-readiness-provenance.test.ts`, 4 cases.

**Mutation pass — 3 mutations, each caught by its intended test:**

| reverted | caught by |
|---|---|
| explain label → `'Oura readiness'` | the label case, plus the pre-existing `group-signals` fallback case |
| prompt line → `- Oura readiness` / `'not connected'` | the source-scan case |
| digest string → `Oura readiness: N/100` | the digest case |

**Two deliberately equivalent controls, both green (11/11):** renaming the internal
`readiness` local in `group-signals.ts`, and rewording an **unrelated** prompt line in the scanned
route (`Sleep trend vs baseline` → `versus baseline`). The second is the one that mattered — a
source-scan test's failure mode is being too broad, and this shows it does not fire on ordinary
edits to the file it scans.

The prompt line is asserted by reading the route source rather than by rendering the route,
because the failure reaches the user only as generated prose and catching it any other way needs a
live model call.

## Not exercised

Browser and device both unexercised — the change is three string literals and a comment, with no
layout, no safe-area, no offline path and no native surface. The owner's stated check is to open
*Why <session>?* and read the row; that is a Railway deploy away and needs no APK.

## Out of scope, stated so it is not re-litigated

Whether **46 is a good score** on a day with HRV well above baseline is calibration, not naming.
That belongs to TN-6 and BF-13, which are open.
