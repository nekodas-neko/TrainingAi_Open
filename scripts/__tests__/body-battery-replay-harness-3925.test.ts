// #3925. The replay harness captures only from a database on this machine, and carries no copy of
// the model: it runs `finishedBodyBatteryDay`, so a constant mirrored here would be a second copy.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isLocalDatabase } = require('../tuning/body-battery-replay.cjs') as { isLocalDatabase: (url: string) => boolean }

describe('body-battery-replay.cjs (#3925)', () => {
  it('captures from a socket or localhost only', () => {
    expect(isLocalDatabase('postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433')).toBe(true)
    expect(isLocalDatabase('postgres://a:b@localhost:5433/x')).toBe(true)
    expect(isLocalDatabase('postgresql://a:b@127.0.0.1/x')).toBe(true)
    expect(isLocalDatabase('postgresql://u:p@db.example.invalid:5432/x')).toBe(false)
    expect(isLocalDatabase('postgresql://u:p@localhost/x?host=db.example.invalid')).toBe(false)
    expect(isLocalDatabase('postgresql://u:p@127.0.0.1.example.invalid/x')).toBe(false)
    expect(isLocalDatabase('not a url')).toBe(false)
  })

  it('mirrors no model constant and bundles no single piece of the day', () => {
    const src = readFileSync(join(__dirname, '../tuning/body-battery-replay.cjs'), 'utf8')
    expect(src).not.toMatch(/chargeRate|drainRate|restOffsetBpm|walkBodyBattery/)
    expect(src).toMatch(/body-battery-replay'/)
  })
})
