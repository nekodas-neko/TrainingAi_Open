// LB-171 — a field whose name and colon have words between them is not a field.
//
// `decorated-field.js` catches a marker written IN FRONT of a field. This is the same failure from
// the other side: the bullet opens with the field's name, reads to a human as a declaration, and
// says something before reaching the colon — `**Keep / Done when:**`, `**Keep ①, the owner's:**`.
// Every matcher anchors the colon directly after the name, so none of it parses.
//
// **RV-210 sat at rank 1 of Lane B's READY list this way.** All three of its fixes had shipped and
// its only residue was a device pass, so an implementer working the queue top-down took a finished
// entry and found nothing to build — the starvation `Keep:` exists to prevent.
//
// As with its sibling, the interesting half is what it must NOT flag, and there are two kinds.
// Every one of these field names is also an ordinary verb the backlog uses with a trailing colon
// (`**Needs hardware the agent does not have (~5):**` introduces a list), and the em-dash form
// `**Keep — …:**` parses correctly today. The first draft of this rule flagged RV-143, which is
// how the verb case was found — by running it, not by reasoning about it.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { interruptedField } = require('../lib/interrupted-field.js') as {
  interruptedField: (line: string) => { field: string; between: string } | null
}

describe('a field interrupted between its name and its colon', () => {
  it('catches the one that reached rank 1 of a lane', () => {
    expect(interruptedField('- **Keep / Done when:** P26 shows no input or submit button covered'))
      .toEqual({ field: 'Keep', between: '/ Done when' })
  })

  it('catches an enumerated residue, which is how two more were filed', () => {
    expect(interruptedField("- **Keep ①, the owner's:** three phantom rows")?.field).toBe('Keep')
    expect(interruptedField('- **Keep ②, the device check:** start a guided walk')?.field).toBe('Keep')
    expect(interruptedField('- **Keep ①: the additive write is better**')?.field).toBe('Keep')
  })

  it('leaves the correct form alone', () => {
    expect(interruptedField('- **Keep:** the device pass')).toBeNull()
    expect(interruptedField('- **Gate: owner** — the mockup has been shown')).toBeNull()
    expect(interruptedField('- **Needs:** LB-149')).toBeNull()
  })

  // The verb case. These are sentences, not declarations, and a check that fires on them is a check
  // somebody turns off.
  it('leaves the field names used as ordinary verbs alone', () => {
    expect(interruptedField('- **Needs hardware the agent does not have (~5):** PS-8, PS-9')).toBeNull()
    expect(interruptedField('- **Needs a production write or the owner physically present (~2):** RV-108')).toBeNull()
    expect(interruptedField('- **Keep the model and constrain it harder** (enumerate rest)')).toBeNull()
    expect(interruptedField('- **Keep the signal, move it.** He asked for it')).toBeNull()
    expect(interruptedField('- **Verify on the device, not in the sandbox.** This is a layout')).toBeNull()
  })

  // Flagged on shape, but the check suppresses it by asking the real parser — which reads this form.
  // The rule deliberately does not try to know that itself; `check-backlog-pointers.js` does.
  it('reports the em-dash form on shape, leaving the caller to ask the parser', () => {
    expect(interruptedField('- **Keep — three things, none of them engine:**')?.field).toBe('Keep')
  })
})
