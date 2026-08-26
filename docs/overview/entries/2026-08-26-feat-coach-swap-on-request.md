# 2026-08-26 — the Coach only swaps an exercise when asked (Q-403)

**Branch:** `feat/coach-swap-on-request` · **Lane A** · v1.383.4

## What the owner actually decided, which was none of the three options offered

Q-403 began as a copy defect: the Coach announced an already-applied swap as a *"proposal"*, after
the fact. Investigating it surfaced something the owner did not know — **the swap edits the program**,
not today's workout — and on being told, they did not want the capability as it stood:

> *"You dont want to be changing excercises during a program or you will lose progress for it — plus
> for some people it would be hard to learn a new movement."*

Presented with **remove / keep-and-warn / gate-on-injury**, they answered with a fourth thing:

> *"id only like the coach exercise swap to be done from the AI chat when the user requests it"*

Keep it; never volunteer it.

## The finding that killed my own recommendation before it was built

I had recommended **gating the swap on an open injury**, on the grounds that the owner named injury
as the only useful case. Verifying it first showed that recommendation was wrong:
`components/workout/injury-swap-sheet.tsx` already offers `injurySafeAlternatives` mid-workout, and
its handler (`components/workout-screen.tsx:961`, `handleInjurySwap`) mutates **local React state
only** — `setExercises`. It never writes `session_exercises`.

So an injured user already gets a substitute for today, keeps their program, and loses no
progression. Gating the Coach's **permanent** swap on injury would have made it do a program edit for
the exact case that already had a **non-destructive** answer — worse than either extreme. The lead
was the injury domain's own comment: *"`injurySafeAlternatives` drives per-exercise substitutions at
workout time."*

That is why the new warning **points at the in-workout swap** rather than simply discouraging.

## Shipped

1. **The system prompt forbids an unprompted swap.** Written by mirroring the idiom the Deloads
   section already uses — *"Propose it only when they ask for it… never open a conversation with
   it"* — rather than inventing a second phrasing for the same rule.
2. **The confirmation card states the permanence**: that it changes the named session and applies
   from now on, that progression history on the outgoing lift stops advancing, and that a one-off
   change today is the in-workout swap.

**Point 2 is on the card and not in the prompt, deliberately.** This entry's own investigation
measured the prompt's existing ordering instruction being ignored **3 times out of 3**. A consequence
rendered from the patch cannot be ignored, forgotten, or reworded by the model. A prompt rule is
advisory; a rendered consequence is not.

## Still owed — Q-403 stays queued

The **sentence ordering** is not fixed. The model writes its text after the widget 3 of 3 times
despite an explicit instruction, so a correct *"here is the proposal to…"* still arrives describing a
decision the user has already made. Prompting has failed at it once, and the investigation's
hypothesis — that the AI SDK's `stopWhen: stepCountIs(6)` loop makes a trailing text step the natural
shape — was never tested. Whoever takes it should test that before writing more prompt; the
alternative is rendering text above widgets, which is Lane B and undoes a deliberate choice. With
swaps now only happening on request, the sentence is less misleading than it was, which is why this
is a residual rather than a blocker.

## Verification

Five DB-backed cases over the real handler: it warns on a swap, names the session and the outgoing
lift, points at the in-workout alternative, warns on a removal too, and **does not** warn on a patch
that changes neither. Mutation-tested — removing the disclosure fails 4 of 5, narrowing it to swaps
only fails the removal case. Full suite, `pnpm check:rules`, `tsc --noEmit`, lint.

## Not exercised

**The prompt change is unverifiable from here.** Whether the model actually stops volunteering swaps
is a behavioural property of a live LLM, and nothing in the test suite can assert it — the same
reason the ordering instruction was ignored 3/3 without anything catching it. It needs a real chat
session to confirm, and the card's warning is what holds regardless of what the model does. Also not
exercised: the device, and the rendered appearance of the new consequence (Lane B's surface).
