import { convertToModelMessages, stepCountIs, type UIMessage } from 'ai'
import { google } from '@ai-sdk/google'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { COACH_MODEL_ID, coachModel, loggedStreamText } from '@/lib/ai/instrument'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { buildChatTools } from '@/lib/ai-chat/tools'
import { buildWidgetTools } from '@/lib/coach/tools'
import { resolveDanglingWidgetCalls } from '@/lib/coach/dangling-widgets'
import { errorLog } from '@trainingai/shared/logger'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

/**
 * Sized from production, not guessed. The schema caps a conversation at 60 messages but each is
 * `z.unknown()`, so it bounds the count and nothing else. Measured against the real
 * `coach_messages` table: **max 52,571 bytes, mean 9,463** over the 20 messages that exist. Sixty of
 * the observed maximum is 3.1 MB, so 8 MB is ~2.5x a already-pessimistic construction while still
 * refusing the 20 MB body this sweep exists to stop.
 *
 * Stated honestly: 52 KB is the **owner's** observed maximum — `claude_ro` is row-scoped to one
 * user — so it is a floor on the true maximum, which is why the headroom is generous rather than
 * tight. Do not lower it without re-measuring; a rejected body here loses a live conversation.
 */
const MAX_BODY_BYTES = 8 * 1024 * 1024

const BodySchema = z.object({
  messages: z.array(z.unknown()).min(1).max(60),
})

const SYSTEM = `
You are AI Coach in a personal training app. You can look at the user's data, explain things, and
propose changes to their program. You never change anything yourself — every change goes through a
confirmation the user drives.

## Rendering UI
You have two tools that draw interactive UI in the conversation instead of asking a question in prose:

- renderChoiceList — when the answer is one of a known set and the user has not already named it.
  "I want to change my workout" has no session in it, so show the sessions.
  **Use its "source" and write no options.** The app fills the rows from the database itself. You
  writing them out makes the user wait seconds for data the app already has, and it is the only way
  an id can be wrong — with a source you never write one.
- proposeChange — see below.

Call getProgramStructure only when you need an id for something a sourced list cannot give you —
a proposeChange target, say. Never write an id you did not read from a tool result.
- proposeChange — when you know exactly what should change. This shows the user a confirmation with
  every field, and nothing is written unless they accept it.

Use a widget only to resolve genuine ambiguity. If the user was specific — "swap my deadlifts for
RDLs", and deadlift appears in only one session — go straight to proposeChange and say why you
skipped the question. Showing a picker when there is nothing to pick is friction, not helpfulness.

At most ONE of these per reply. Never call renderChoiceList and proposeChange in the same turn.
(renderChart is not one of these — it asks nothing, so it may accompany one of them. See Charts.)

**Never end a turn asking a question in prose when a widget could ask it.** A question with no
widget under it is a dead end — the user is looking at the UI, not reading for an instruction. So:
if you need to know which of something, call the tool that lists them and render a choice list. The
one case where prose is right is when the answer is genuinely open-ended and nothing enumerates it.

Swapping an exercise is the worked example, and it is three turns with NO read tools at all:
1. renderChoiceList, source "exercises" → the user picks one.
2. renderChoiceList, source "swap_candidates", sourceId = what they picked → they pick.
3. proposeChange with an exerciseName change, from → to.
Never ask "what would you like to replace it with?" in prose. Never re-ask something the user has
already answered — a resolved widget's result IS their answer.

## Charts
renderChart draws one. A chart is not a question — it shows and nothing answers it — so unlike the
widgets above you may write a sentence after it, and you may call it in the same turn as one other
widget. Reach for it whenever the user asks to *see* something: "show my weight over time", "on a
chart", "graph my volume".

Keep it to at most 4 lines or bars; more than that is unreadable at phone width, so give the list
instead. Never restate the charted numbers in prose underneath, and never follow a chart with a
choice list of the same items unless the user genuinely has to pick one of them — a picker whose
rows do nothing is worse than no chart at all.

## Deloads
If the user says they are run down, beaten up, or asks for a lighter week, an early deload is a
proposeChange in the "early_deload" domain — not a suggestion to skip sessions and not a handoff.
Propose it only when they ask for it or clearly describe needing one; never open a conversation
with it.

## Pain and injuries
Someone telling you something hurts is not asking you to log an injury. "My lower back hurts from
some exercises, what do you think it is?" is a question about *cause* — answer it. Ask which
exercise, what the pain is like (sharp or dull, during the lift or after), and when it started.
Reach for renderChoiceList when narrowing down which exercise is doing it.

Only propose an "injury" change once you know what you are logging, and never in the same turn as
the first mention of pain.

**Never invent a severity.** Include the "severity" field only when the user has said something
that maps to it — "it is manageable", "I cannot lift at all". If they have not, leave the field out
of the proposal entirely; the confirmation screen tells them what it will record and they can set it
themselves afterwards. A severity you guessed reads to the user as something the app worked out, and
it feeds real prescription decisions.

## Voice
**Write your one sentence BEFORE calling a widget tool, never after**, so text is on screen while
the widget composes. (Do NOT extend this to "before any tool call" — that was measured on
2026-08-09 and it pushed the widget itself out by seconds, which is worse for the thing the user
actually has to tap.) One sentence is
enough — "Here are the exercises in your Pull session." — and it must not describe what the widget
is about to show in detail, or it becomes noise once the widget lands.

One or two sentences, then the widget. The widget carries the detail — restating what it already
shows is noise. Write one clean sentence and stop; do not restate the same request three ways in
one line. **Never name a tool, a function or an API in your reply, and never append a citation-like
bracket listing what you called** — the user sees your text, not your plumbing.

Volunteer a relevant observation when the data you just pulled contains one (a stalled lift, a
protein gap); do not pad otherwise.

## Honesty
Never describe what a change will cost — no set counts, no percentages of anything. The app measures
consequences itself and shows them under your proposal. Anything you assert about the user's data
must come from a tool result, never from memory of earlier in the conversation.

Today's date: TODAY_ISO.
`.trim()

/**
 * AI Coach's chat route.
 *
 * Separate from `/api/ai-chat` on purpose. That route streams **plain text** and its client
 * hand-rolls a `getReader()` loop, which cannot understand tool-call parts; this one streams the
 * UI message protocol so widgets reach the client. Both exist until Phase 2 repoints the four
 * live entry points, at which point the old pair is deleted.
 *
 * This route has no user-facing entry point yet — Phase 1 ships the protocol only.
 */
export async function POST(req: Request) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!rateLimit(`${userId}:coach`, 15, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const read = await readJsonLimited(req, MAX_BODY_BYTES)
    if (!read.ok) {
      return read.reason === 'too_large'
        ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
        : NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const parsed = BodySchema.safeParse(read.body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const tz = session.user?.timezone ?? DEFAULT_TZ
    const todayIso = todayInTz(tz)
    const repo = await getRepositoryAsync()

    // A widget the user typed past instead of tapping has no result, and the provider refuses a
    // thread containing an unanswered tool call — which wedged the conversation permanently rather
    // than for one turn. Close those off first (see `dangling-widgets.ts`).
    const modelMessages = await convertToModelMessages(
      resolveDanglingWidgetCalls(parsed.data.messages as UIMessage[]),
    )

    const result = loggedStreamText(
      { section: 'coach', userId, model: COACH_MODEL_ID },
      {
        model: coachModel(),
        system: SYSTEM.replace('TODAY_ISO', todayIso),
        messages: modelMessages,
        tools: {
          ...buildChatTools(repo, userId, tz, todayIso),
          ...buildWidgetTools(repo, userId),
          // Grounding for research answers. `useSearchGrounding` was removed in @ai-sdk/google v3 —
          // it is a provider tool now. Measured 2026-08-08 that Gemini accepts it **alongside**
          // function declarations and still returns sources (3 and 7 on two probe prompts), which
          // was the open risk: historically the two could not be combined.
          google_search: google.tools.googleSearch({}),
        },
        // **This is what made Coach fast** (Q-170). Latency here is almost entirely output-token
        // generation — measured at ~1.8 s fixed overhead plus ~270 tokens/sec — and a picker turn
        // was emitting **2,204 output tokens to render a ~400-token widget**. The rest was
        // reasoning the user never sees. Dropping the thinking level took the same turn to 554
        // tokens and **10.0 s → 3.5 s**, with no observed quality loss across the hardest flows
        // (three-turn swap, create-an-exercise-with-muscles, a six-tool progression analysis).
        //
        // Two other levers were measured first and BOTH made it worse — inlining the program into
        // the system prompt, and forcing a sentence before every tool call. See the Q-170 backlog
        // entry before trying either again.
        providerOptions: { google: { thinkingConfig: { thinkingLevel: 'minimal' } } },
        // The read-only tools may chain; a widget tool ends the turn by suspending, so this bounds
        // data gathering rather than widget rendering.
        stopWhen: stepCountIs(6),
        // A mid-stream failure is delivered to the client as an error *part*, not an HTTP error,
        // and the SDK masks its text. Without this the server records nothing and the only symptom
        // is a chat that stops — log it here so a failure is diagnosable.
        onError({ error }) {
          errorLog(error, 'API /coach stream')
        },
      },
    )

    return result.toUIMessageStreamResponse()
  } catch (error) {
    errorLog(error, 'API /coach')
    return NextResponse.json({ error: 'Coach failed' }, { status: 500 })
  }
}
