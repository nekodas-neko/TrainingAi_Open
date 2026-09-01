# 2026-09-01 — three owner gates cleared, and the device queue had stopped covering the device gates

Branch `docs/owner-decisions-2026-09-01`. Docs-only. The owner asked for questions with
recommendations and alternatives attached; four went out, four came back.

## The decisions

**BF-84 — a per-session Rest button. Answer: it is a FACT, store it.** The owner replied *"happy to
continue just having it as 'rest' = no workouts logged so it just changes the display on home card —
but also happy to have it in the DB. Whatever would be better in the long run."* That is the call
handed back with the criterion attached, so the criterion decides it. Rest days are training data:
if a chosen rest is only a display condition, load, cadence and phase counting all read it as a
*missed* session. And `no workouts logged` is a different claim from `I chose to rest` — a day with
no logs is also a day you forgot or were ill. Stays Lane A, engine first. It costs a migration and a
sync domain, taken deliberately.

**Q-187 — meal-plan re-scaling. Answer: spread, at read time, with a floor.** Lane B. The owner also
asked for the choice between spread and next-meal-only to be *offered*; that is deferred to its own
entry with a written reason — a preference shipped alongside the behaviour it toggles has no
evidence behind either branch, and spread was explicitly fine if only one ships.

**Q-531 — where the device consoles live. Answer has a hard half and a soft half.** The owner:
*"happy to have it wherever you want; but it should be behind the admin portal — as regular users
should not be able to touch it."* The hard half settles Q-234's premise: Q-234 moved these to
Settings → Developer on a taxonomic argument that never weighed *who may reach them*, and the app
has other users. Back behind `/admin`, with `requireAdmin` rather than an unlinked route — hiding a
page is not gating it. The soft half was handed back, so: one screen carrying drain → re-sync →
verify in runbook order, because the original complaint (*"everything is spread out sporadically"*)
is about the flow being broken across places, and reverting the location alone leaves that intact.

**The device pass — the owner chose all of it as one checklist.** Which is what turned up the
finding below.

## `device-verification-queue.md` had quietly stopped being true

The file's own coverage line claimed it held *every* `Gate: device` entry in the queue — 27, as of
2026-08-26. The queue now carries **39**, across both lanes, and **22 were not in the file at all**.
The sentence that made the doc trustworthy was stale, which is worse than an incomplete list, because
a reader checks the claim rather than the contents.

All 22 are added, grouped by where you already are, and the header now states the honest shape of
the sitting rather than a count: **~25 are presses you can run now**, 4 need a fresh `apk-latest`
(`Q-537`, `Q-533`, `Q-418`, `LB-36`), 5 need the Colmi ring in hand, and 5 are not presses at all.
Calling 39 device-gated entries "39 checks" would have wasted the sitting.

**Two were already answered and nobody linked it back.** `D7` established on 2026-08-30 that
`spo2V` *is* populated — one of `Q-34`'s two blocking questions — while `Q-34` still reads as fully
blocked, so the next session would have asked again. What it genuinely still owes is whether `spo2V`
*separates*, plus the device Redecode that `D4` records as having **failed**. And `Q-147`'s cold-start
measurement is `S3`, answered *"loads fast"* with no number: not closed, but not worth re-asking with
a stopwatch either. Both are now cross-linked in place.

`Q-537` is flagged to run first on any new APK: the ring key still has exactly one copy, in Android
SharedPreferences, and the export affordance shipped 2026-08-23 without ever being used.

## Not done

Nothing was verified on a device by this session — it cannot be. The checklist is the deliverable,
not its results.
