# 2026-09-28 — LA-115: Health Connect's HRV, SpO₂ and HR-series records convert

The pinned plugin's `RecordConverter` returned `record.toString()` for any type without a branch.
Three types the sync reads had none, so their fields were `undefined` and every record was dropped
silently. The patch adds the three branches, written from connect-client 1.1.0-alpha11's own
sources jar (found in the local Gradle cache) rather than from memory. It also fixes the TS union,
which the earlier patch had widened with the wrong HRV type. The five `as any` casts that hid the
gap are removed, and `tsc` is clean without them.

**Kotlin compiled on this machine for the first time from a lane.** It used the Android SDK and
Android Studio's JBR, with Gradle online to fetch its compiler. A deliberate typo failed at the
patched line, so the build compiled the new file. One trap: `npx cap sync android` on Windows
writes pnpm's shortened directory names into `capacitor.settings.gradle`. Never commit that; CI
regenerates it on Linux.

Merging publishes a new APK, because `pnpm-lock.yaml`'s patch hash moved. The device check is
owed (Known-Issues row, `Verify: device` on the entry).
