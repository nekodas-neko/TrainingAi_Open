# The workout write path can be driven past set 1 (Q-461)

**Branch:** `fix/start-set-bounce-blocks-automation` · **Lane B** · v1.363.5

## What shipped

One CSS rule and one E2E spec.

`app/globals.css`'s existing `prefers-reduced-motion` block gains `.animate-bounce { animation:
none !important; }`, alongside the particles and the marquee it already stops. `e2e/workout-set-loop.spec.ts`
drives a real workout — recommendation card → pre-workout → countdown → warm-up → Start Set 1 →
Log Set 1 → Start Set 2 → … → three logged sets — and asserts they reached Postgres.

## What was wrong, measured

The Start Set button carries `animate-bounce` while `workoutPhase === 'rest'` — the W1 affordance
`CLAUDE.md` documents by design. Playwright's actionability check needs a stable bounding box for
two consecutive frames, and an infinite animation never gives one.

Reproduced on this spec's own flow, before and after the rule:

```
reducedMotion=reduce          animation=none | 1            CLICKED in 85ms
reducedMotion=no-preference   animation=bounce | infinite   BLOCKED after 8009ms
```

So the affordance is untouched for anyone who has not asked for less motion. **This is a
testability fix, not a repair of a user-facing defect** — a human tapping a bouncing button was
never affected, and the entry says so explicitly.

It is also the accessibility-correct behaviour, and it follows the rule the block's own comment
already states: decorative motion stops entirely, *functional* indicators freeze to their static
state. The button stays where it is and stays primary; it stops moving.

`force: true` is deliberately not used anywhere in the spec. It bypasses **every** actionability
check including "is this covered by an overlay", so a spec written that way would keep passing
straight through a real regression.

## The spec is a guard, and it was checked as one

Removing the CSS rule makes it fail — verified, not assumed. It fails on
`toHaveCSS('animation-name', 'none')` before the click, so the failure names the cause instead of
timing out.

Three things it has to work around, each of which cost a run to find:

- **`/workout` and the pre-workout screen both carry a button reading "Start Workout."** The first
  is the Workout tab's recommendation card; the session id appearing in the URL is what separates
  them.
- **A 3-second countdown overlay** sits between the second press and the warm-up.
- **The set write is fire-and-forget by design** (CLAUDE.md, "Saves feel instant"), so a single
  database read straight after the last tap races it. The assertion polls.

The spec deletes the workout sessions it created in `afterAll`, matched against the exact set of ids
that existed before it ran — the harness shares one database serially, and a workout left in flight
would make the next spec's pre-workout screen offer "Continue Workout".

## Verification

- Spec **passes** with the fix, **fails** without it. Three sets logged at 75 kg × 8, confirmed in
  `set_logs` rather than only on screen.
- `tsc --noEmit` clean · `eslint` **zero warnings introduced** (124 both with and without the
  change — measured by stashing) · `pnpm check:rules` **Ran 55 of 55**.

## Not exercised

**The follow-on spec Q-461 names — log-set through complete-workout — is not written.** This one
stops after three sets of the first exercise. What it unblocks is the ability to write that one at
all, which was the entry's point.

Nothing checked on the S25. The rule only fires under `prefers-reduced-motion: reduce`, so the
device behaviour is unchanged unless the owner has that Android setting on — worth one look with it
enabled, since the bounce is the cue that a set is next.
