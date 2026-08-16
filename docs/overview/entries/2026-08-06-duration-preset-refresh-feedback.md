# 2026-08-06 — the header refresh button no longer lies about generation being done

**Domain:** workouts — v1.267.2, JS-only (no APK rebuild)

## The report

Q-86 (owner UI-bug batch): changed the Push pre-workout time budget to "Normal" (60 min); the AI
Prescription card took a noticeable while to update, including after tapping the header refresh
icon, before eventually loading on its own.

## Root cause — a decoupled-feedback bug between two controls, not a caching bug

The duration-preset switch (`handleDurationPresetChange`, `components/workout-screen.tsx`)
correctly forces an uncached, real LLM regeneration — that latency is intentional and correct
(caching across presets would serve a 60-min prescription after switching to 30-min). The bug is
the UI: the header refresh button (`RefreshCwIcon`, `pre-workout-screen.tsx`) was wired only to
its *own* unrelated re-fetch (`refreshExercises` — workout-data + periodization status), whose
loading flag resolves almost immediately because a cache seed already exists. Tapping refresh
during an in-flight duration-preset generation spun briefly, stopped, and looked "done" while the
actual AI card was still generating underneath it — exactly the reported sequence.

Confirmed there's no double-generation risk: `refreshExercises` never calls the `/prescribe`
endpoint directly — it only clears the once-per-episode `prescribeFiredForRef` guard (which
matters for the separate `aiPrescriptionPending`-driven auto-generation effect, not for
duration-preset switches, which don't touch that flag at all). Also confirmed
`durationSwitching` already flips synchronously before the `await`, driving the existing
"Preparing your AI workout…" heading swap correctly — no change needed there.

## The fix

`pre-workout-screen.tsx`'s header refresh button: `disabled`/`animate-spin` now bind to `loading ||
prescriptionPending` instead of just `loading`, so it stays visibly busy and un-tappable for the
whole `aiPrescriptionPending || durationSwitching` window — a tap during generation can't present
a misleading "done" state, and (per the plan's task 3) is disabled outright rather than allowed to
fire its own unrelated refetch mid-generation, so it can't race a real (if harmless) request against
the generation in flight.

## Verification

Typecheck and lint clean (pre-existing, unrelated `voice-log-button.tsx` missing-module error).
Full suite: 401 files / 3,175 tests green.

Seeded the local DB with an `ai_dynamic`-mode program + a real `session_periodization` prescription
row (no owner LLM key configured in this sandbox, so a real generation call couldn't be relied on
to land predictably), then drove the real UI against it with Playwright: intercepted the
`/api/ai-periodization/session/*/prescribe` POST to add an artificial delay, tapped "Long," and
confirmed mid-flight — via both a full-page screenshot and a direct DOM attribute check — that the
refresh button's `disabled` attribute is present and its icon carries `animate-spin` for the entire
window the "Preparing your AI workout…" heading is shown, in both light and dark themes. One early
run gave a false negative from state bleeding between sequential test runs (a prior run's real
POST had already landed and changed the persisted `durationPreset`, making a later click on the
same preset a no-op) — re-run with isolated state to confirm the real behavior. All seeded/modified
DB rows (`session_periodization`, `programs.phase_mode`) reverted afterward.

**Not exercised:** on-device (S25) — JS-only change, no safe-area/gesture/native surface. Also
didn't verify against a real (non-mocked) LLM call end-to-end, since no `GOOGLE_GENERATIVE_AI_API_KEY`
is configured in this sandbox — the mocked-delay approach verifies the client-side state binding,
which is what this bug was in, not the generation itself.
