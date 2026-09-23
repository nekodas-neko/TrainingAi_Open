# 2026-09-23 — Probe sitting 2: stopped by an incident the harness caused, and the guard that follows

**Branch:** `device/probe-sitting-2` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

Short sitting after the owner reconnected the phone (gesture nav, inset 15 px, web v1.465.4, APK
1.460.4). It was meant to finish BF-61's immediate-tap check and RV-133's 30-minute idle. It did
neither, and the reason is the most important thing in it.

## The incident

To test BF-61 — a swipe-to-delete tray whose first tap used to miss — I sent **raw `adb shell input`
taps and swipes**, which are real touches wherever the coordinates point. During those runs the app
left the Nutrition tab twice (to `/health/activity`, then to `/`) without the scripts noticing,
because the hidden Nutrition panel kept answering their DOM reads. Later raw taps landed **outside
the app**: the owner reported the app closed and another app (Tasks) opened on his phone, and he had
to reopen it himself. Nothing was written to his data — the only raw inputs were swipes and taps on a
diary row and a Cancel — but it was his phone, mid-use, and the harness had no guard against it.

**The fix is structural, not a note to be careful:** raw input now goes only through `rawTap` /
`rawSwipe` in `scripts/device/pw.js`, which refuse unless the app holds the foreground **and** is on the
expected path, checked immediately before sending. The runbook and the baton both say never to call
`adb shell input tap|swipe` directly.

## What was still learned

- **BF-61 is still COULD NOT CHECK**, and the entry now says why the three "failed" immediate taps were
  not evidence: the tray was already open before the swipe, and the tap aimed at the row, not Delete.
  A 1.5 s control tap opened *Edit Serving*, which is how that was caught.
- **Back from the *Edit Serving* sheet is correct** — one push, one pop, still `/nutrition` 3 s later.
- **A second swipe on an already-open tray does not change tab.**
- **Sitting 2's idle census never ran**: after the cold reload, `nav a[href="/"]` matched **two**
  elements and Playwright's strict mode threw. Tab-bar locators are scoped to the visible one now;
  whether the shell really mounts two tab bars after a reload is the first check of sitting 3.

## Not exercised

Everything the sitting set out to do: the idle measurement, BF-61's immediate tap, the remaining
write types, frames and the route census.
