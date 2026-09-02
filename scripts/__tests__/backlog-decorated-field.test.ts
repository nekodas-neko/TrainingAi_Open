// LA-55 — a field with a warning sign in front of it is not a field.
//
// `Gate:`, `Needs:` and `Verify:` are matched directly after the bullet's `**`, so one decorative
// character in between makes the whole field invisible. **Q-388 headed Lane A's READY list while its
// first bullet read `⚠ Gate: owner` and its second sentence said "treat this as blocked on a device
// reading, not on a decision."** The existing inline-field guard could not catch it: that guard's
// own pattern needs `**Gate:` adjacent, which is the same assumption that caused the bug.
//
// The interesting half of this rule is what it must NOT flag. The backlog carries thirteen lines
// that put a character before one of these field names legitimately, and a check that fires on them
// is a check somebody turns off.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { decoratedField } = require('../lib/decorated-field.js') as {
  decoratedField: (line: string) => { decoration: string; field: string } | null
}

describe('a decorated field declaration', () => {
  // The line as it actually stood in Q-388.
  it('catches the one that shipped', () => {
    expect(decoratedField('- **⚠ Gate: owner — VOID AS WRITTEN, not answered.** It asked the owner'))
      .toEqual({ decoration: '⚠', field: 'Gate' })
  })

  it('catches the other markers someone reaches for when a block matters', () => {
    expect(decoratedField('- **⛔ Needs:** BF-1 — blocked')?.field).toBe('Needs')
    expect(decoratedField('- **🔴 Verify: device**')?.field).toBe('Verify')
    expect(decoratedField('- **❗ Gate: owner**')?.field).toBe('Gate')
  })

  it('reads the field name back, so the failure can name what was ignored', () => {
    expect(decoratedField('- **⚠ Needs: Q-1**')).toEqual({ decoration: '⚠', field: 'Needs' })
  })
})

describe('what it must not flag', () => {
  // The Protocol section documents these fields by name. Flagging it would fire on the very text
  // that tells people how to write them.
  it('leaves a backticked mention alone', () => {
    expect(decoratedField('> - **`Gate: owner`** / **`Gate: device`** — waiting on an owner decision')).toBeNull()
    expect(decoratedField('>   **⚠ `Gate: device` means BLOCKED** — the work cannot start')).toBeNull()
  })

  // ✅ records that the gate was cleared; the entry is then parked, or not, by something else.
  it('leaves a cleared gate alone', () => {
    expect(decoratedField('- **✅ Gate: owner CLEARED 2026-08-30** — *"lets go with that."*')).toBeNull()
    expect(decoratedField('- **✅ Gate: owner SIGNED OFF 2026-08-30.**')).toBeNull()
  })

  it('leaves a struck-through line alone, which is how a superseded gate is kept', () => {
    expect(decoratedField('- ~~**⚠ Gate: owner — does not fit this gate.**~~ *(Superseded)*')).toBeNull()
  })

  // The correct form, and the one the failure message tells people to write.
  it('leaves a properly written field alone, marker and all', () => {
    expect(decoratedField('- **Gate:** device — ⚠ the owner gate it used to carry is void')).toBeNull()
    expect(decoratedField('- **Verify:** device')).toBeNull()
    expect(decoratedField('- **Needs:** BF-84')).toBeNull()
  })

  it('leaves prose that merely uses the word alone', () => {
    expect(decoratedField('- The `Gate: owner` was removed 2026-09-01, and it had been stale')).toBeNull()
    expect(decoratedField('  redone on the current APK — which is device queue **S9**.')).toBeNull()
  })
})
