# 2026-09-15 — BF-165 is not device-only, and two of its three candidates are dead

**Branch:** `docs/bf165-reproduced-in-harness` · **Lane B** · docs-only

Owner, on the APK: *"when I try click the treadmill; or any 'Other activity' nothing actually
happens."* Narrowed by him the same day: *"it just scrolls to the top of cardio hub."*

BF-165 was filed as a runtime diagnosis with three candidates, an instruction to **start from the
device console**, and a verification step that is a device procedure. It was sitting at the top of
READY as unstartable.

**It reproduces in a browser.** `/cardio` → *Other activity* → *Treadmill*, and the URL stays
`/cardio`. No device, no WebView, no console.

## What was refuted, by experiment rather than reading

**Candidate 2 — the `/activity` route fails to load — is dead.** A direct `goto('/activity')` returns
**200**, renders *"Log Activity — What are you doing?"*, and logs **zero** page errors.

**Candidate 3 — the close cancels the push — is dead, including the sharper version of it that
looked certain.** `selectType` does three things in one tick:

```ts
startActivity(...)
onOpenChange(false)      // close the sheet
router.push('/activity') // navigate
```

`SheetContent` renders `BackDismiss`, so an **open sheet is holding a pushed history entry**
(`sheet-back-stack.openSurface`), and closing it runs `closeSurface`, which calls **`history.back()`**
to undo that push. A queued pop landing on the entry the push just created would produce the reported
symptom exactly — same screen, scroll reset. It is a clean mechanism and it is wrong.

Reordering to push first and deferring `onOpenChange(false)` by **1200 ms**, so no pop is anywhere
near the navigation, leaves it **still on `/cardio`**. The popstate simply moves to ~1.5 s after the
tap and changes nothing.

## The survivor

`push('/activity')` is not a tab href and not the current URL, so it goes through `animate()` — which
runs the push inside `document.startViewTransition` and polls for the URL against a **300 ms** cap.
Sampled every **10 ms for 4 s**, the URL never becomes `/activity`, not even transiently.

## The trap that produced a wrong conclusion here

**"The URL never showed `/activity`" does not prove the push never started.** Next updates the URL at
**commit**, so an aborted commit and a never-started push are indistinguishable from `location`.

I read the sampler as refuting the history-pop hypothesis and was wrong to — both hypotheses predict
the same trace. Only the deferred-close experiment separates them. A sampler alone cannot, and the
next person reaching for one should know that before they trust it.

This is the same shape as the BF-100 probe earlier today: the measurement was real, the inference
from it was not. The difference is that here the follow-up experiment existed and was run.

## The next experiment, so it is not re-derived

Drive the same `useTransitionRouter.push('/activity')` from a control on `/cardio` that is **not
inside a sheet**.

- If it navigates → the sheet/portal context is the variable.
- If it does not → `animate()` itself is the defect, which is **app-wide navigation** and must not be
  changed on a hypothesis.

**Do not lengthen `NAVIGATION_TIMEOUT_MS`.** The entry's own warning stands: that turns a dead tap
into a slow dead tap.

## Nothing shipped in code

The probe spec is red by construction — it asserts the navigation that does not happen — so committing
it would make CI red, and inverting it would pin a defect as intended behaviour. What it established
is in the entry. The fix touches app-wide navigation and is not something to land at the end of a
session on a surviving-by-elimination hypothesis.
