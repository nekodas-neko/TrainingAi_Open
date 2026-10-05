import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildPlan } = require('../backlog-to-issues.js')

const backlog = `# Backlog

## Queue

### [sleep] LA-1 — fix the nap split
- **Lane:** A
- **Added:** 2026-09-01
The body of LA-1.

### [readiness][sleep] LA-2 — depends on LA-1
- **Lane:** A
- **Needs:** LA-1
Body two.

### [platform] BF-3 — a bug found by BugFix
- **Lane:** B
Body three.

### [devices] DV-4 — check it on the phone
- **Lane:** DV
Body four.

### [platform] OR-5 — what does the owner want?
- **Lane:** O
Body five.
`.split('\n')

const csv = `id,parent,verdict,type,group,bucket,lane,domains,gates,needs,keepKind,added,reverify,note,title
LA-1,,issue,engine,,ready,A,sleep,,,,2026-07-01,yes,,fix the nap split
LA-2,,issue-blocked,blocked,,parked,A,readiness sleep,,LA-1 LA-1,,2026-09-01,,,depends on LA-1
BF-3,,issue,surface,,ready,B,platform,,,,2026-09-01,,,a bug found by BugFix
DV-4,,fold-device,,device-check:devices,ready,DV,devices,,,,2026-09-01,,,check it on the phone
OR-5,,question,question,,ready,O,platform,,,,2026-09-01,,,what does the owner want?
OR-6,,archive-reference,,,reference,O,platform,,,,2026-09-01,,,not migrated
`

const plan = buildPlan({ csvText: csv, backlogLines: backlog, sha: 'abc123' })
const byKey = Object.fromEntries(plan.map((p: { key: string }) => [p.key, p]))

describe('backlog-to-issues buildPlan', () => {
  it('creates one issue per work entry and one per folded group, and nothing for archived rows', () => {
    expect(plan.map((p: { key: string }) => p.key)).toEqual(['LA-1', 'LA-2', 'BF-3', 'OR-5', 'group:device-check:devices'])
  })

  it('puts the idempotency marker FIRST, so truncation can never remove it', () => {
    for (const p of plan) expect(p.body.startsWith(`<!-- backlog-id: ${p.key} -->`)).toBe(true)
  })

  it('labels by what the entry is, where it lives, and who builds it', () => {
    expect(byKey['LA-1'].labels).toEqual(['type: feature', 'area: sleep', 'lane: engine', 're-verify', 'agent: implementer'])
    expect(byKey['BF-3'].labels).toContain('type: bug')
    expect(byKey['BF-3'].labels).toContain('lane: surface')
    expect(byKey['OR-5'].labels).toEqual(['type: question', 'area: platform'])
    expect(byKey['group:device-check:devices'].labels).toEqual(['type: device-check', 'area: devices', 'agent: implementer'])
  })

  it('marks a blocked entry, and de-duplicates its blockers', () => {
    expect(byKey['LA-2'].labels).toContain('blocked')
    expect(byKey['LA-2'].blockedBy).toEqual(['LA-1'])
    expect(byKey['LA-2'].body).toContain('**Blocked by** {{LA-1}}')
  })

  it('carries the entry text and a pinned link to its source line', () => {
    expect(byKey['LA-1'].body).toContain('The body of LA-1.')
    expect(byKey['LA-1'].body).toContain('/blob/abc123/docs/implementation-backlog.md#L5')
    expect(byKey['LA-1'].title).toBe('LA-1 — fix the nap split')
  })
})
