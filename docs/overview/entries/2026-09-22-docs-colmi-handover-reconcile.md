# 2026-09-22 — the Colmi after handover: what was verified, what was filed, what went stale

**Branch:** `docs/colmi-handover-reconcile` · docs only, no code

The ring went to a second wearer. This session checked whether the pipeline actually works for
someone who is not the owner, and reconciled the durable docs against what the check found.

## Verified, so a Known Issue moved to the archive

**PS-21 Stage A has now run on a device, in production.** The row asking for that check was written
around `decodedBy`, which is a response field and therefore invisible once the sync is over. The
stronger evidence turned out to be the ordering column: `colmi_raw_frames` holds **200 rows with
`seq > 0`, max 157**, and `seq` is written only by the route that shipped with migration 263. A
WebView holding an older bundle cannot produce it. Moved to `known-issues-resolved.md`.

**A second user's data is landing.** `pg_stat_user_tables` counts the whole database rather than one
user, and it records **37 readings and 23 frames inserted since 8 September** while the owner wrote
**zero** over the same window. The mechanism was then proved directly: a brand-new user with no rows,
posting real archived frames as bytes only, got `decodedBy: "server"` and **119 readings stored on
their own id and nothing else's**.

## Amended rather than struck, because the check cannot be run

**Colmi auto-sync is still not device-verified, and now says why.** 16 syncs over 3–8 September at a
scatter of hours no one presses by hand, three of them evening — consistent with the timer working,
and not proof. Nothing distinguishes an automatic sync from a pressed one once it arrives:
`attemptAutoSync` records its last run in `localStorage` and the ingest route stores no trigger. The
row now names the cheapest fix (a `trigger` field on the ingest body) instead of waiting on an
observation that cannot be made.

Striking it on the sync scatter would have been the easy call and would have recorded an inference as
a fact.

## Filed: PS-47, the battery

Unfiled until now, and it cost two days of the baseline week. The stored series gives **~19
points/day, about five days from full**; the ring hit **1% on 4 Sept** and returned **no sensor data
at all between 5 Sept 19:35 and 7 Sept**. A flat ring presents exactly like a broken one — same
`reason: 'silent'`, same copy — which is the part a second wearer would misread. Also records an
unexplained **40 hours pinned at exactly 70%**.

## Went stale: PS-16's gate

`Gate: device` read as "the owner has not got round to it". The ring is no longer with the owner, so
the counted walk is blocked on whoever holds it. PS-15's steps half waits behind it via `Needs:`.

## Not done

No code. The Colmi still has **no native layer** — the manifest declares foreground services and
boot receivers for Oura, Polar and Scale, and `grep -rli colmi android/` returns nothing — so it
syncs only while the app is open, unlike the Oura. That is PS-21 Stages B and C, and it needs an APK.
