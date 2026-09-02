# BF-105 — the guided walk's phase change now lands on the screen

**Branch:** `feat/bf-105-walk-phase-cue` · **Lane:** B · **Domain:** `[activity]` `[app-shell]`

The owner, mid-walk, with a screenshot: *"there isn't enough of a queue to indicate session phase
changed. needs more sound and possible visually cues."*

## The cue was firing; it carried nothing

The entry had already established this and it held up: `scheduleWalkCues` posts one local
notification per boundary, the `workout-timers` channel exists at importance 4 with vibration, and
`USE_EXACT_ALARM` puts it on the `setExactAndAllowWhileIdle` path. Nothing about the timing was
wrong.

What did not exist was any in-app response. `walk-active.tsx` called `hapticSuccess()` once, at
`e >= plan.totalSec` — the end of the whole walk. On a segment boundary the screen's entire reaction
was one word swapping and changing colour, with the countdown resetting beside it. Everything else —
bpm, spm, steps, the pacer bar — was unchanged. That is easy to miss while walking and looking up,
which is the reported failure.

## What shipped

A haptic per boundary, keyed on `active.segment.index` rather than a timer, so it fires exactly once
per change however often the 1 Hz tick re-renders. `hapticSuccess` for fast, `hapticLight` for
everything else: through a pocket the pattern is the whole signal, because the notification's text is
unreadable and both directions post to one channel with one sound.

**It deliberately does not fire on mount.** The screen mounts with an active segment when a walk
already in progress is reopened, and buzzing there announces a change that did not happen. That is
`shouldCuePhaseChange`'s only job, and it is the assertion a naive version fails.

Visually, a vignette wash of the incoming phase's colour plus the phase word scaling in rather than
swapping. **A vignette rather than a full overlay, deliberately:** peripheral vision is what has to
catch this — the walker's eyes are on the path — and a centred wash would dim the readout it is
drawing attention to. Under `prefers-reduced-motion` the wash still fires, longer and without the
word's scale, per the repo's convention that a functional indicator keeps its state and loses its
motion. Here the flash *is* the state.

`walk-cues.ts:44` said the opposite of the truth — its catch block claimed *"the in-app timer still
drives cues when foregrounded"*, and there was no such path. That comment is why the entry read as
handled for as long as it did. Corrected.

## Two corrections to the entry's second half

Both measured rather than reasoned, and both change what that half costs:

**Do not delete `workout-timers`.** The entry says the old channel should be deleted "so the app's
notification settings don't accumulate a dead row". It is not dead: `lib/notifications.ts:76` posts
the workout rest-timer alert to it. Deleting it silences every rest alert in the app.

**Two channels cannot differ by feel without a sound file.** The pinned plugin's `Channel` type
exposes `vibration?: boolean` — a flag, not a pattern — so `walk-cue-fast` and `walk-cue-slow` could
only differ by one of them not vibrating, which is worse than today. Distinguishing them needs
`sound?: string` against a file in `android/app/src/main/res/raw/`, **which is an APK change**. So
the whole second half is APK-gated, not the JS-only work the entry describes. BF-105 stays queued on
`Gate: device` with that written down.

## Verification

14 unit tests driving the two exported decisions directly, with **seven mutations killing them**:
cueing on mount, one haptic for every kind, firing on every render, advancing the last-cued index
only when a cue fired, dropping `relative` so the wash escapes its container, flashing before any
change, and ignoring reduced motion.

One e2e spec seeds a walk in progress and watches a real boundary in a browser: the walk opens on
Slow with no flash in the DOM, and after the boundary the word reads Fast and the flash is there.
Both assertions are durable rather than racy — the flash stays mounted once cued, so nothing has to
catch an 800 ms animation mid-flight.

`pnpm check:rules` **Ran 67 of 67**; `tsc`, `check-test-typecheck` and lint clean.

## Not exercised

**The haptic, which is the half the report is actually about.** `Haptics.impact` is a Capacitor call
that no-ops off the APK, so the pocket case cannot be reached from the sandbox at all — the e2e spec
proves the visual half and nothing about the feel. Also unexercised: whether the two patterns are
actually tellable apart through a pocket while walking, which is a judgement only the owner can make,
and the notification path itself, which was already working and was not touched.
