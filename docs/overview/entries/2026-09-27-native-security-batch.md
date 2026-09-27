# OR-159 + RV-196 — two native security fixes in one APK cycle

**Branch:** `lane-a/native-security-batch` · **Lane A** · `Batch: native-security`.
**⚠ Owner confirmation before merge** (RV-196 carries that gate; OR-159 is security-adjacent).

## Why these two together

Both are `android/**`, both need a new APK, and both entries say in their own words not to ship
native work alone — RV-196: *"Batch it with the next native change rather than cutting an APK for
it alone"*. One cycle, two fixes.

## Why they were not skipped

These sat at the head of Lane A's READY list for days, passed over as "auth/security — owner's".
That reading is wrong, and re-reading the rule is what unblocked them. `CLAUDE.md` says
confirmation is required **before merging** an auth/security change, not before building one. The
effect of treating them as unbuildable was that the top of the queue was permanently inert while
work below it shipped.

## OR-159 — the session cookie is out of backup

`android:allowBackup="true"` with no rules meant Auto Backup took `app_webview/Cookies`, a live
credential: restored onto another device it is a signed-in session. Now excluded via
`backup_rules.xml` (API 23-30) and `data_extraction_rules.xml` (API 31+) — both, because minSdk is
26 and targetSdk 36.

**Scoped to the cookie, as the entry insists.** The ring key is in `shared_prefs/oura_ble.xml` and
is a separate decision (OR-160), left exactly as it was.

**One call of mine, flagged rather than buried:** `device-transfer` is excluded as well as
`cloud-backup`. The approval was for keeping the cookie off a restore onto another device, and a
direct phone-to-phone transfer lands it on another device exactly as a cloud restore does. The
cost is re-signing in after switching phones. Easy to drop if that is not wanted.

## RV-196 — the ring key's three doors

1. **`setIngestUrl`** accepted any absolute URL on all three plugins, persisted it, and made the
   foreground service post raw frames there — a redirect that survives restarts. It now goes
   through a new pure `IngestUrlPolicy`: the app's own origin over https, plus loopback, nothing
   else.
   - It **parses with `java.net.URI` rather than prefix-matching**, and refuses userinfo.
     `https://trainingai-production.up.railway.app@evil.example.com` has host `evil.example.com`
     and reads as the app's origin both to a human and to the obvious prefix check. That case is
     the reason the policy is not three lines.
   - **Loopback is allowed on purpose** — it cannot move data off the device, and the emulator and
     local harnesses need it.
2. **`revealKey` and `clearKey`** now need a native `AlertDialog` tap. A system dialog is drawn
   outside the WebView, so a script in the origin can open it and cannot answer it. Both callers
   are explicit buttons in the ring debug console, so the cost is one deliberate extra tap; nothing
   calls either automatically, which I checked before adding it.

The Kotlin comment that said "every caller is already app JavaScript" was right, and that is
precisely the problem: it makes the CSP the only boundary, and the CSP allows `'unsafe-inline'`.

## Verification, and its limits

- **`IngestUrlPolicy` has 9 JVM tests**, which CI runs via `android.yml` — covering the app origin,
  an arbitrary host, the prefix near-miss, userinfo smuggling, plaintext to the app host, loopback,
  non-http schemes, empty/null, and normalisation.
- XML well-formedness checked for all three files; `tsc` clean; Custom Rules **80 of 80**.
- **Kotlin cannot be compiled in this container** (no Android SDK, Gradle download proxy-blocked),
  so the compile and the APK build come from `android.yml` on the PR. That workflow is not a
  required check, so **its result must be read rather than assumed** before this merges.

**Not exercised — and this is the part that matters here.** Nothing was run on the device. Not the
dialog, not ingest after the allowlist, not a restore. Three specific things are owed on the next
APK, and both entries keep a `Keep:` line saying so:

1. The confirm dialog appears for reveal/clear and is answerable.
2. Ring, scale and strap ingest still reach the server — if the app shell ever passes an origin
   the allowlist does not cover, uploads stop silently.
3. Sign-in survives a normal launch. The backup exclusion is currently **unobservable**: the local
   store is 31.2 MB against Auto Backup's 25 MB quota, so nothing is backed up at all until D4's
   pruning lands.

## Shipped user-visible

v1.477.3 with three changelog lines. The version bump is deliberate here — unlike most changes,
this one only reaches the device through a new APK.
