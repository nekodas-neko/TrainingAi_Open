# 2026-08-14 — Coach asks about pain instead of logging an injury off it (Q-227)

**Branch:** `claude/trainingai-backlog-v0abea`

Owner: *"Im getting lower back pain from some of my excercises what donyou think it is?"* Coach's
entire reply was a **"Log Lower Back Injury"** card — Area: lower back, Severity: **mild**,
Apply/Cancel — and no prose at all. Owner: *"this is okay; but I would of preffered more diagnostic
before reccomending an injury."*

Two faults, and only one of them is about asking questions.

## The guardrail that existed for two other domains and not this one

`SYSTEM`'s `## Deloads` section says: *"Propose it only when they ask for it or clearly describe
needing one; never open a conversation with it."* The `program_phase` domain has its own version in
the tool description. **`injury` had neither.** Its tool description lists which fields to fill and
says nothing about when filling them is appropriate, so a bare mention of pain was sufficient grounds
to fire `proposeChange` immediately.

The new `## Pain and injuries` section says pain reported is not a request to log anything, names what
to ask (which exercise, sharp or dull, during or after, when it started), points at
`renderChoiceList` for narrowing down the exercise, and forbids proposing in the same turn as the
first mention of pain.

## The severity was invented, and the fix is not only a prompt

The owner's message contains no severity language — no "mild", nothing extractable. `severity` is a
free-choice field in `ChangePreviewSchema`, so the model produced it from nothing. That is what
`SYSTEM`'s own `## Honesty` rule forbids (*"anything you assert about the user's data must come from a
tool result"*), and it contrasts with the manual injury sheet the domain was built to match, where
severity is **always three buttons the user taps**.

Telling the model to omit the field is only half a fix, because `apply` already had
`severity ?? 'moderate'`. Omitting it moves the fabrication from the model into our own default —
still silent, and severity feeds real prescription decisions. So the confirmation screen now says what
it will record:

> Recorded as moderate — change it in Health → Injuries if that is not right

Only when the proposal omits severity. A supplied one is already a visible change row on the card, and
repeating it as a consequence would read as though the app had decided it.

The literal is now `ASSUMED_SEVERITY`, named once. `preview` has to promise the exact value `apply`
writes, and two copies of `'moderate'` would let the confirmation screen say one thing while the row
recorded another — the test asserts promise and write together for that reason.

## What this does not do

It does not make severity a required tap in the Coach flow. That would mean an editable field on the
change-preview card, which is a device-gated UI change and a larger piece of work than the entry
scoped. What it does is stop the app presenting a guess as a finding, and tell the user where to
correct it. The injury domain's preview/apply/undo logic was already correct and is untouched.

## Verified

Seven cases pinning the prompt text, two pinning the preview behaviour.

**Mutation-verified four ways.** Deleting the consequence fails the case that asserts it; pushing it
unconditionally fails the case that asserts silence when severity was given; changing
`ASSUMED_SEVERITY` to `'mild'` fails the promise-equals-write case; deleting the whole prompt section
fails 5 of the 7 prompt cases.

**A prompt test has a specific trap and this one hit it.** The first version matched raw text and
failed on *"never in the same turn as / the first mention of pain"* — the phrase straddles a hard wrap.
Assertions now run against a whitespace-collapsed copy, so a reflow cannot fail a test while the
instruction is still there. The suite also asserts the extracted prompt is over 2,000 characters and
still contains `## Deloads`, so a broken slice cannot make every case pass on absence.

Full suite green — **463 files, 3,832 tests**. `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33.

**Observed on the live route.** `POST /api/coach/preview` with an injury patch carrying no severity
returns the assumption as its first consequence; the same patch with `severity: severe` returns the
list without it. Both on the dev server, authenticated, rather than only through the domain handler.

**Not exercised: the model.** This is the honest limit of the change. The prompt half is untestable
without spending a real Gemini call on a real conversation, so what is proven is that the instruction
is present and specific — not that the model obeys it. The behavioural half (the assumed-severity
line) is proven against the domain. Whether Coach now asks before proposing is something the owner
will see the next time they mention pain, and worth reporting back either way.

Also not exercised: the S25. The consequence line renders inside the existing change-preview card, so
it needs no new layout, but it has only been seen as a string in a test.
