## 2026-07-28 — Q-19b: the model-only prompts still quoted bodyweight 1RMs in kilograms

**Branch:** `fix/prompt-bodyweight-1rm-units` · Q-19b cleared

Q-19 (v1.224.0) fixed every surface whose text reaches the **user**. These three were left because
they feed the model only — a wrong unit is never quoted back at anyone. That reasoning is why they
were deferred, and it is also why they still mattered: an internal 1RM of 118 for a Pull-Up is a
kg-domain number with no physical meaning for the movement, and handing it to a model that
prescribes *loads* invites a load that cannot exist for that exercise.

- `lib/ai-periodization/prompt.ts` — `baseline_1rm`, `current_1rm`, and the `rm1_trend` delta.
- `lib/workout/review/prompt.ts` — `current_1rm`.
- `app/api/nutrition-goals/recommend/route.ts` — the PR lines (lowest value: it feeds a calorie
  recommendation that doesn't act on the unit, but it's the same one-line fix).

All now render through the shared `displayOneRm` / `displayOneRmDelta` / `describePersonalRecord`
helpers, so there is no fourth formatting of a 1RM anywhere.

`exerciseType` reaches the prompts via a new `getExerciseTypes` repo lookup threaded into
`PrescriptionSignals` — mirroring how muscle assignments and equipment already arrive there. Both
prompt builders share that type, so the single addition covered both.

The `rm1_trend` delta needed more than a unit swap: `rm1ChangeKg` is a kg-domain *difference*, so it
can't be relabelled — it's recomputed through `displayOneRmDelta`, which converts both endpoints to
reps first. A change smaller than one rep correctly reports 0 rather than a fractional figure.

### Verification

Full suite **2,521 passing** (the 20 failures are the pre-existing `claude_readonly` connection
tests), `tsc`, lint and both custom-rule checks clean. Four new tests pin a bodyweight exercise
rendering as `RM` in both prompts, a weighted one still rendering `118 kg`, and the trend delta not
appearing as `+8.0 kg`.

My first attempt built a minimal `PrescriptionSignals` stub and failed on missing required fields —
rebuilt on the fixture `prompt-recovery-signals.test.ts` already uses, which is both correct and one
less shape to maintain.

### Not exercised

No live model call — the assertions are on the prompt strings, which is the whole surface of the
change. Nothing user-visible, and nothing device-specific.
