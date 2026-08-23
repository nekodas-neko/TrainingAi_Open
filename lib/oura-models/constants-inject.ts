/**
 * Push the vendored model constants into the ports that need them, on the server.
 *
 * The ports take their constants by **injection** rather than reading disk themselves (Q-221 for
 * the steps decoder, Q-545 for daytime-stress and resilience). That is what keeps `node:fs` out of
 * their module graphs — and the Oura rollup imports all three, so it is the difference between a
 * rollup that can run in the WebView and one that cannot.
 *
 * It sits beside `constants-delivery.ts` rather than inside `constants/`, for the same reason that
 * one does: `.gitignore` excludes `lib/oura-models/constants/*` (the vendored data left the repo in
 * Q-49) with an explicit negation per code file, so a new file added in there is silently untracked
 * and every local gate still passes.
 *
 * SERVER-ONLY: this is the one module that still reads the constants directory. A device build
 * injects the same three from an authenticated route instead, the way
 * `lib/activity/steps-decoder-constants-client.ts` already does for the steps decoder.
 *
 * Idempotent and cheap — every call after the first is three boolean checks — so a composition root
 * that is unsure whether boot reached it should just call it.
 */
import { getStepsDecoderConstants, getDaytimeStressConstants, getResilienceConstants, getCumulativeStressConstants } from './constants'
import { setStepsDecoderConstants, hasStepsDecoderConstants } from './steps-motion-decoder'
import { setDaytimeStressConstants, hasDaytimeStressConstants } from '@/lib/health/daytime-stress'
import { setResilienceConstants, hasResilienceConstants } from '@/lib/health/stress-resilience'
import { setCumulativeStressConstants, hasCumulativeStressConstants } from '@/lib/oura-models/cumulative-stress'

/**
 * Inject every constant table a server request path can reach. Throws if the constants directory is
 * missing or malformed — the same failure the lazy disk read produced before, moved to one place
 * where it is a boot failure rather than a scatter of unrelated 500s.
 */
export function ensureServerOuraConstants(): void {
  if (!hasStepsDecoderConstants()) setStepsDecoderConstants(getStepsDecoderConstants())
  if (!hasDaytimeStressConstants()) setDaytimeStressConstants(getDaytimeStressConstants())
  if (!hasResilienceConstants()) setResilienceConstants(getResilienceConstants())
  if (!hasCumulativeStressConstants()) setCumulativeStressConstants(getCumulativeStressConstants())
}

/**
 * The same injection, but never throwing.
 *
 * For composition roots that want the constants present if they can be — the repository handle, in
 * practice — without taking on the failure. `ensureServerOuraConstants()` throws when the files are
 * unreadable, and the repository is on the path of every DB route in the app; letting it throw
 * there would turn "the stress tables are missing" into "nothing in the app works", which is a
 * strictly larger outage than the one this is fixing.
 *
 * Swallowing is safe because it changes nothing about what a caller sees: an unset table still
 * throws at the accessor, at the read site, exactly as it does today. This only ever *adds* a
 * chance for the constants to be there.
 */
export function tryEnsureServerOuraConstants(): void {
  try {
    ensureServerOuraConstants()
  } catch {
    // The accessor throws at the read site if this did not take. See the doc comment.
  }
}
