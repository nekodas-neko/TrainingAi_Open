import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import type { PeriodizationPhase } from '@trainingai/shared/types/ai-periodization'
import { POST_TRANSITION_STATUS } from './status'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { isOneDayDeload } from '@trainingai/shared/ai-periodization/one-day-deload'
import { serveStoredPrescription, syncProgramPhase } from '@trainingai/shared/ai-periodization/program-phase'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { isBusyError } from '@trainingai/shared/errors'

// One phase transition.
const MAX_BODY_BYTES = 16 * 1024

const BodySchema = z.object({
  newPhase: z.enum(['accumulation', 'intensification', 'realisation', 'deload']),
  force: z.boolean().optional(),
}).strict()

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: z.infer<typeof BodySchema>
  try {
    const read = await readJsonLimited(req, MAX_BODY_BYTES)
    if (!read.ok) {
      return read.reason === 'too_large'
        ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
        : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    body = BodySchema.parse(read.body)
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { sessionId } = await params
  const badId = invalidUuidResponse(sessionId)
  if (badId) return badId
  const repo = await getRepository()

  // #3766: read the program's phase first (running the switch-over if it is due), so the state below
  // is the one the move starts from.
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const program = await repo.getActiveProgram(userId)
  const onProgram = program?.sessions.some(ps => ps.id === sessionId) ?? false
  const programPhase = program && onProgram
    ? await syncProgramPhase(repo, userId, program.id, tz)
    : null

  const state = await repo.getSessionPeriodization(userId, sessionId)
  if (!state) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // #3907: the plan as the card serves it (`serveStoredPrescription`, as `respond` and `next-session`
  // read it). An aged-out plan, or one whose deload has ended (#3876), is not on the card, so a stale
  // tap on it takes nothing.
  const served = await serveStoredPrescription(repo, userId, onProgram ? program : null, state, tz)

  // The recommendation lives on the stored prescription (pendingTransition is currently
  // never written) — the card only offers this transition when phaseAction is
  // transition_recommended/deload_recommended and sends prescription.phase as newPhase.
  const isRecommended = state.prescription != null
    && (state.prescription.phaseAction === 'transition_recommended' || state.prescription.phaseAction === 'deload_recommended')
    && state.prescription.phase === body.newPhase
  // #3799: "Move to Deload" on a deload offered for one day's reason (`isOneDayDeload`) takes that
  // session's lighter plan and leaves the phase where it is — the same as accepting it. Older app
  // builds send this for both the offer's button and the phase list, so only an explicit `force`
  // (the phase list in current builds) moves the phase to `deload` over a one-day offer. A planned
  // deload (the realisation ceiling's `transition_recommended`) is not a one-day deload and moves
  // the phase as before. An offer already trained or turned down has nothing left to accept, and
  // is never a reason to move the phase either.
  if (body.newPhase === 'deload' && !body.force && state.phase !== 'deload' && isOneDayDeload(state.prescription)) {
    if (served.prescriptionAgedOut) {
      return NextResponse.json({ error: 'This prescription has expired. Reopen the session for a fresh one.' }, { status: 409 })
    }
    // #3900: on the AI plan a prescribed deload is already the day's plan (`auto_applied`), so the tap
    // takes what is already taken and writes nothing. No other program kind stores one that way.
    if (state.prescriptionStatus === 'auto_applied') {
      return NextResponse.json({ state, prescriptionStatus: 'auto_applied', phaseMoved: false })
    }
    if (state.prescriptionStatus !== 'pending' && state.prescriptionStatus !== 'accepted') {
      return NextResponse.json({ error: 'This deload offer has already been answered. Reopen the session for a fresh one.' }, { status: 409 })
    }
    await repo.updatePrescriptionStatus(userId, sessionId, 'accepted')
    const unchanged = await repo.getSessionPeriodization(userId, sessionId)
    return NextResponse.json({ state: unchanged, prescriptionStatus: 'accepted', phaseMoved: false })
  }

  // #3876: a move to the phase this session type is already in changes nothing. It used to fall
  // through to `advancePhase`, which wrote a new start and 0 sessions, so a deload already two
  // sessions in started again. The plan on offer is taken (as the one-day deload path takes it);
  // with none left to take, the call answers with the state unchanged. `force` does not change this:
  // picking the current phase from the phase list is not a restart either.
  if (body.newPhase === state.phase) {
    const onOffer = served.prescription != null
      && !served.prescriptionAgedOut
      && state.prescriptionStatus === 'pending'
    if (onOffer) await repo.updatePrescriptionStatus(userId, sessionId, 'accepted')
    const unchanged = onOffer ? await repo.getSessionPeriodization(userId, sessionId) : state
    return NextResponse.json({
      state: unchanged,
      prescriptionStatus: onOffer ? 'accepted' : state.prescriptionStatus,
      phaseMoved: false,
    })
  }

  // #3766: a move is either the one on offer or an explicit `force` (the phase list). The next phase
  // alone used to be enough; with the phase now the program's, an unoffered move from one type's
  // screen would move every type.
  if (!isRecommended && !body.force) {
    return NextResponse.json({ error: 'Transition not recommended — pass force:true to override' }, { status: 400 })
  }

  // #3766: the phase is the program's, so one tap moves every session type. A program still waiting
  // for its switch-over moves only this session type, as before. The program move carries the phase
  // and start this request saw: a second tap (or another session's auto-apply) landing after the
  // first finds the program moved and changes nothing, so it cannot void the plans regenerated since.
  // That move leaves this slot 'consumed' itself, so the status write is only the per-type path's.
  if (programPhase?.aligned) {
    try {
      await repo.advanceProgramPhase(userId, sessionId, body.newPhase as PeriodizationPhase, {
        phase: state.phase, phaseStartedAt: state.phaseStartedAt,
      })
    } catch (err) {
      // #4082 review: gave up waiting for the person's other write (a check-in, a Coach apply), or was
      // ended as a deadlock victim: nothing was written, reported once where it happened. Send it again.
      if (isBusyError(err)) return NextResponse.json({ error: err.message, busy: true }, { status: 409 })
      throw err
    }
  } else {
    await repo.advancePhase(userId, sessionId, body.newPhase as PeriodizationPhase)
    await repo.updatePrescriptionStatus(userId, sessionId, POST_TRANSITION_STATUS)
  }
  const updated = await repo.getSessionPeriodization(userId, sessionId)

  // Regeneration is fired by the CLIENT (see ai-prescription-card.tsx's executeTransition) — a
  // container→own-origin self-fetch is unreliable in prod, which is exactly why the open-time and
  // completion-time triggers already moved client-side (workout-screen.tsx). The slot is left in
  // POST_TRANSITION_STATUS, so even if that call is lost the pre-workout screen's existing poll
  // and prescribe trigger recover it on the next open.
  return NextResponse.json({ state: updated })
}
