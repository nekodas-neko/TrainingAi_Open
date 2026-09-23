// TN-59. An entry may be parked by a `Gate:`, an unmet `Needs:`, or the legacy prose marker
// `⛔ blocked: <reason>`. The first two are fields — readable, actionable, already validated by
// `check-backlog-pointers.js`. The third is a sentence, and when it is the ONLY thing parking an
// entry the entry is invisible for a reason nothing can act on.
//
// RV-99 is the case this was written from: parked in Lane B behind *"⛔ The blocking hazard was NOT
// the one the entry named"* — a CORRECTION about which hazard the entry had misidentified, which is
// the opposite of a reason not to build it. No `Gate:`, no `Needs:`; startable the whole time.
//
// These cases run against synthetic queues on purpose. The real backlog has zero offenders — that
// is the baseline, and it is asserted last — so every judgement this check makes is one the real
// file cannot currently exercise. That is the same argument `queue-buckets.js` records for itself,
// where reordering two branches passed every test because no entry happened to carry both fields.
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

import { parseEntries, proseParkedOnly } from '../lib/backlog-entries'

const repoRoot = path.resolve(__dirname, '..', '..')

/** The check's own rule — imported, not restated, so the test cannot pass against a stale copy. */
const offenders = (md: string) =>
  proseParkedOnly(parseEntries(md.split('\n'))).map((e) => e.id)

const queue = (...entries: string[]) => ['## Queue', '', ...entries].join('\n')
const entry = (id: string, ...body: string[]) =>
  [`### [platform] ${id} — a title`, '', ...body, ''].join('\n')

describe('an entry parked by prose alone', () => {
  it('is reported when nothing structured says why', () => {
    expect(offenders(queue(entry('RV-1', '- **⛔ blocked: waiting on a thing**')))).toEqual(['RV-1'])
  })

  it('is not reported when a Gate: states the block', () => {
    expect(
      offenders(queue(entry('RV-2', '- **Gate:** device', '- **⛔ blocked: waiting on a thing**'))),
    ).toEqual([])
  })

  it('is not reported when an unmet Needs: states the block', () => {
    expect(
      offenders(
        queue(
          entry('RV-3', '- **Needs:** RV-4', '- **⛔ blocked: waiting on a thing**'),
          entry('RV-4', '- a real entry, still queued'),
        ),
      ),
    ).toEqual([])
  })

  // An absent `Needs:` target means SHIPPED — the protocol removes a completed entry — so it parks
  // nothing, and it must not rescue an entry from this check either. Without this case, adding a
  // stale `Needs:` would be a way to silence the check while leaving the entry just as invisible.
  it('is reported when its only Needs: target has already shipped', () => {
    expect(
      offenders(queue(entry('RV-5', '- **Needs:** RV-999', '- **⛔ blocked: waiting on a thing**'))),
    ).toEqual(['RV-5'])
  })

  // The narrowed rule (`⛔` followed by "block" within 40 characters) is the file's own documented
  // convention. Emphasis is the overwhelming majority use and must stay silent — a detector with a
  // 75% false-positive rate teaches implementers to ignore the section it fills, which is precisely
  // how LA-49 sat parked by the bug it described for three weeks.
  it('is silent on the glyph used as emphasis', () => {
    expect(
      offenders(queue(entry('RV-6', '- **⛔ Do not extend this to the conic-gradient rings.**'))),
    ).toEqual([])
  })

  it('is silent when "block" is far enough away to be prose about something else', () => {
    const far = '- **⛔ Corrected — the entry welded two jobs together and mis-sized it.** The block'
    expect(offenders(queue(entry('RV-7', far)))).toEqual([])
  })

  // RV-99's actual sentence, which is a correction rather than a block.
  it('reports the RV-99 shape it was written from', () => {
    const rv99 = '- **⛔ The blocking hazard was NOT the one the entry named.** It warned about Chart.js'
    expect(offenders(queue(entry('RV-99', rv99)))).toEqual(['RV-99'])
    const reworded = rv99.replace('The blocking hazard', 'The real hazard')
    expect(offenders(queue(entry('RV-99', reworded)))).toEqual([])
  })

  it('holds the real backlog at zero — the baseline', () => {
    const md = fs.readFileSync(path.join(repoRoot, 'docs/implementation-backlog.md'), 'utf8')
    expect(offenders(md)).toEqual([])
  })
})
