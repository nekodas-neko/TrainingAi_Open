# 2026-09-28 — BF-111: the APK's build date comes from the APK

Device Verification's 2026-09-23 screenshot showed About reading "built 23 Aug" for an APK built on
2026-09-20. Measured live on 2026-09-28: the `apk-latest` release was **created 2026-08-23** and
never moves, and only its `app-debug.apk` asset is replaced (last uploaded 2026-09-25). So
`published_at` has been the first build's date for every build since.

`mapApkRelease` now dates the build from the asset's `updated_at`, and falls back to the release date
only when there is no asset. The module comment claiming the release is recreated on every publish
was wrong and is corrected. Tests cover both cases, and the old source fails the first.

**Owed:** a look at More → About on the S25, recorded as a `Keep:` on BF-111. The card renders only
on native.
