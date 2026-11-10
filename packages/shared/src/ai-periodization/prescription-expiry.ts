import { nextMidnightInTz } from '@trainingai/shared/date-utils'
import type { AiPrescription, SessionPeriodization } from '@trainingai/shared/types/ai-periodization'

// How long a stored prescription is the plan for its session, and when it stops being one (#3700).
//
// A session's next prescription is generated when the previous session completes and is then served
// whenever that session is next opened, up to a week later. That is right for a plan sized on
// training history. It is wrong for a plan sized on ONE day's readiness: a rest-day recommendation
// written on a sick morning was still being served, with its "for reference" exercise list, as the
// plan for a healthy day a week later (owner, 10 Nov).

/** A plan built from training history: good for the week it covers. */
export const PRESCRIPTION_TTL_MS = 7 * 86_400_000

/** What, beyond the action itself, makes a prescription a one-day answer. */
export interface ExpiryContext {
  /** The emergency deload fired on the lifter's own sick report (`EmergencyTrigger.kind === 'illness'`). */
  illnessTriggered?: boolean
}

/**
 * True when the prescription answers today's readiness rather than the training block, so it must
 * not outlive the local day it was written on.
 *
 * - `rest_day_recommended`: the model's answer to how the lifter is today. Its exercise list is
 *   offered "for reference", never as next week's plan.
 * - `session_swap_recommended`: "train a different session today" (`prompt.ts`), on today's
 *   soreness and the hours since the last session. Tomorrow it answers nothing (#3716).
 * - A deload whose emergency trigger was the lifter's own illness report. That trigger is named at
 *   the decision (`emergencyDeloadTrigger`), so it can be told apart from every other deload.
 *
 * A deload the MODEL recommends is not here: its inputs cannot say whether illness drove it or the
 * block did, so it keeps the week, like the other emergency deloads (load, effort, missed reps,
 * consecutive days) that describe the block rather than the day.
 */
export function isOneDayPrescription(
  prescription: Pick<AiPrescription, 'phaseAction'>,
  ctx: ExpiryContext = {},
): boolean {
  if (prescription.phaseAction === 'rest_day_recommended') return true
  if (prescription.phaseAction === 'session_swap_recommended') return true
  return prescription.phaseAction === 'deload_recommended' && ctx.illnessTriggered === true
}

/**
 * When a prescription written at `now` stops being the plan. A one-day prescription lives until the
 * start of the next local day in `tz`, so the next open after that regenerates from that day's
 * readiness; everything else keeps `PRESCRIPTION_TTL_MS`.
 */
export function prescriptionExpiresAt(
  prescription: Pick<AiPrescription, 'phaseAction'>,
  tz: string,
  now: Date = new Date(),
  ctx: ExpiryContext = {},
): Date {
  return isOneDayPrescription(prescription, ctx)
    ? nextMidnightInTz(tz, now)
    : new Date(now.getTime() + PRESCRIPTION_TTL_MS)
}

/** The expiry branch on its own: a stored prescription past its window is replaced, not re-shaped.
 *  Shared by the reevaluation, the workout and next-session reads, and the Home warm (#2155), so
 *  none of them can disagree about when one is needed.
 *
 *  Every status ages out except `none`, which means there is nothing to age out. `pending` used to
 *  be exempt, on the grounds that the emergency-deload suppression owned an offer's expiry. It only
 *  ever owned an UNEXPIRED pending deload, so nothing retired an expired offer: #3700 found a week-old
 *  sick-day rest offer served as the plan, and #3714 a pending stay. A stay is stored `pending`
 *  whenever `autoApplyPrescriptions` is off or the model's confidence is under the auto-apply bar,
 *  and it drives load, so a session left unused for over a week kept replaying its last plan: the
 *  Q-229 / BF-179 class through the one status those fixes exempted. Past its expiry, an offer of
 *  any kind is pending regeneration.
 *
 *  `prescription` is accepted so callers can pass the stored state as it is; the action no longer
 *  changes the answer. */
export function prescriptionAgedOut(
  state: Pick<SessionPeriodization, 'prescriptionStatus' | 'prescriptionExpiresAt'>
    & Partial<Pick<SessionPeriodization, 'prescription'>>,
  now = new Date(),
): boolean {
  if (state.prescriptionExpiresAt == null || state.prescriptionExpiresAt > now) return false
  return state.prescriptionStatus !== 'none'
}

/** The stored prescription state as a route returns it to a screen (#3716): an aged-out
 *  prescription is left out, and `prescriptionAgedOut` says why. The field is optional on the wire
 *  because Preview also talks to servers from before it existed. */
export type ServedPrescriptionState<T> = T & { prescriptionAgedOut?: boolean }

/**
 * What the session-state reads (the prescription card, the program overview) return for a stored
 * state. An aged-out prescription is not the plan on any read (#3700), so the card, the Deload
 * default and Accept must not see it either: it is replaced by `null` and flagged. The stored row is
 * untouched; opening the session regenerates it.
 */
export function servePrescriptionState<T extends Pick<SessionPeriodization, 'prescriptionStatus' | 'prescriptionExpiresAt'>
  & Partial<Pick<SessionPeriodization, 'prescription'>>>(state: T, now = new Date()): ServedPrescriptionState<T> {
  if (state.prescription == null || !prescriptionAgedOut(state, now)) return state
  return { ...state, prescription: null, prescriptionAgedOut: true } as ServedPrescriptionState<T>
}

/** The client's side of `servePrescriptionState`, for a state read off the wire or a cache. */
export interface WirePrescriptionState {
  prescriptionStatus?: string | null
  /** An ISO string off the wire, or a Date. */
  prescriptionExpiresAt?: string | Date | null
  prescription?: { phaseAction?: string } | null
  prescriptionAgedOut?: boolean
}

/**
 * True when a screen must not treat this state's prescription as the plan: not as the card, not as
 * the Deload default, not as something to Accept (#3716).
 *
 * The server's flag wins when it is there. It is absent from servers older than the flag (Preview
 * talks to production) and from a state cached before the prescription expired, so the expiry is
 * read here too, through the same `prescriptionAgedOut` every server read uses.
 */
export function prescriptionAgedOutOnScreen(state: WirePrescriptionState | null | undefined, now = new Date()): boolean {
  if (state == null) return false
  if (state.prescriptionAgedOut === true) return true
  const raw = state.prescriptionExpiresAt
  const expiresAt = raw == null ? null : raw instanceof Date ? raw : new Date(raw)
  if (expiresAt == null || Number.isNaN(expiresAt.getTime()) || state.prescriptionStatus == null) return false
  return prescriptionAgedOut({
    prescriptionStatus: state.prescriptionStatus as SessionPeriodization['prescriptionStatus'],
    prescriptionExpiresAt: expiresAt,
    prescription: (state.prescription ?? null) as SessionPeriodization['prescription'],
  }, now)
}

/** `state` with an aged-out prescription taken off it, for a screen that holds the state (a cache
 *  seed painted before the expiry included). Returns `state` itself when nothing changes. */
export function hidePrescriptionAgedOutOnScreen<T extends WirePrescriptionState>(state: T, now = new Date()): T {
  if (state.prescription == null || !prescriptionAgedOutOnScreen(state, now)) return state
  return { ...state, prescription: null, prescriptionAgedOut: true } as T
}

/**
 * What the Deload toggle adopts from the session's state before the lifter touches it (#3716), in
 * both apps: the prescription's own flag while it governs the session; `false` once it has aged
 * out, so yesterday's illness deload is not pre-selected this morning; `undefined` when there is
 * nothing to adopt (no prescription, or a `consumed` one that describes a session already run).
 */
export function prescribedDeloadDefault(
  state: (WirePrescriptionState & { prescription?: { deload?: boolean } | null }) | null | undefined,
  now = new Date(),
): boolean | undefined {
  if (state == null || state.prescriptionStatus === 'consumed') return undefined
  if (prescriptionAgedOutOnScreen(state, now)) return false
  return state.prescription?.deload
}
