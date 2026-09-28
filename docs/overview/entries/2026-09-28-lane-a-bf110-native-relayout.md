# 2026-09-28 — BF-110: re-measure the WebView on resume, and record which layer is stuck if not

The blank-on-resume telemetry answered its own question weeks ago. Every blank resume held a 667 px
viewport (a WebView's fallback) against the S25's 826, and a recheck 500 ms later read `stuck` on
25 of 25. That is a stuck viewport, not a late one, so the fix is native, and nobody owned it.

`MainActivity.onResume` now asks the WebView to re-measure against its parent immediately and again
at 250 ms. A return from picture-in-picture or recents can settle its window size a frame late, and
a layout pass with an unchanged size does nothing, so it is harmless on a healthy resume. It may
not be enough: if only Chromium's viewport lags a correctly sized view, a relayout cannot reach it.
So `AndroidRenderer.viewHeights()` exposes the WebView's and its parent's heights, and the recheck
breadcrumb appends them. The next blank resume then says either `resized` (fixed) or which layer
to fix next, and the entry's `Verify:` spells out both readings.

Java compiled locally (a typo in the new code fails the build), and the JS tests cover the message
and a bridge that is absent or throws. Verification is the owner's own telemetry after the APK
installs.
