// Spoken-set parsing, shared by the current app and Preview so the two read a phrase the same way.

// The example phrasing shown under the Voice button and named in its failure message. One string,
// so the hint and the error can never drift apart or from what the parser actually accepts.
export const VOICE_LOG_EXAMPLE = '60 kg 6 reps'

type VoiceToken =
  | { kind: 'number'; value: number }
  | { kind: 'kg' }
  | { kind: 'reps' }
  | { kind: 'sets' }

// A positive tokenizer, not a denylist. The old strip dropped every character outside
// `[0-9.\s kgreps×x]` — which keeps the `r` of `for` and the `es` of `times`, so `60 for 6` became
// `60 r 6` and matched no pattern while `60 by 6` (whose letters all vanish) worked. Nothing about
// the app told anyone which fillers were allowed. Pulling out only the tokens that mean something
// and ignoring every word between them makes each new phrasing work by construction rather than one
// stripped word at a time (BF-66). `x`/`×` need no token of their own: unmatched text is skipped, so
// `80 x 5` and `80x5` both reduce to two bare numbers, which is what the shorthand means anyway.
const VOICE_TOKEN_RE = /\d+(?:\.\d+)?|kilogram(?:me)?s?|kilos?|kgs?|repetitions?|reps?|sets?/g

function tokenizeVoice(transcript: string): VoiceToken[] {
  const tokens: VoiceToken[] = []
  for (const raw of transcript.toLowerCase().match(VOICE_TOKEN_RE) ?? []) {
    if (/^\d/.test(raw)) tokens.push({ kind: 'number', value: parseFloat(raw) })
    else if (raw.startsWith('k')) tokens.push({ kind: 'kg' })
    else if (raw.startsWith('s')) tokens.push({ kind: 'sets' })
    else tokens.push({ kind: 'reps' })
  }
  return tokens
}

// Parse "80kg 5 reps", "5 reps 80", "80 for 6", "60 times 6", "80 x 5", "80 5" etc.
export function parseVoice(transcript: string): { weight?: number; reps?: number } {
  const tokens = tokenizeVoice(transcript)

  let weight: number | undefined
  let reps: number | undefined
  const loose: number[] = []

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok.kind !== 'number') continue
    const next = tokens[i + 1]?.kind
    if (next === 'kg') weight ??= tok.value
    else if (next === 'reps') reps ??= tok.value
    // "3 sets of 60 for 6" — the 3 is neither weight nor reps, and left loose it would take the
    // weight slot ahead of the 60.
    else if (next !== 'sets') loose.push(tok.value)
  }

  // Numbers no keyword claimed fill what is left, weight first — the order every shorthand uses
  // ("60 x 6", "60 for 6"). Beside a keyword a single loose number takes the empty slot, which is
  // what makes "5 reps 80" mean 80 kg. A lone bare number with no keyword at all fills nothing:
  // "60" is as likely to be reps as weight, and guessing wrong logs a wrong set silently.
  if (loose.length >= 2 || weight !== undefined || reps !== undefined) {
    for (const n of loose) {
      if (weight === undefined) weight = n
      else if (reps === undefined) reps = n
      else break
    }
  }

  return { ...(weight !== undefined && { weight }), ...(reps !== undefined && { reps }) }
}

// Clamps voice-recognised weight/reps to the same bounds the +/- controls and
// LogExercisePayloadSchema enforce — an unclamped mis-heard value (e.g. "0 reps",
// weight > 500) otherwise passes the local write but fails the server schema,
// quarantining as a poison mutation.
export function clampVoiceLogResult(weight?: number, reps?: number): { weight?: number; reps?: number } {
  return {
    weight: weight !== undefined ? Math.max(0, Math.min(500, weight)) : undefined,
    reps: reps !== undefined ? Math.max(1, Math.min(100, Math.round(reps))) : undefined,
  }
}
