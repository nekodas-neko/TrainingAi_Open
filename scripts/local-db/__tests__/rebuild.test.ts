// OR-194 ③ — `rebuild.js` opens with `DROP DATABASE … WITH (FORCE)`, so the only thing between a
// typo and a dropped database is `vetTarget`. These pin every way it must say no.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { vetTarget } = require('../rebuild.js') as {
  vetTarget: (raw: string | undefined) => { url: string; dbName: string; adminUrl: string }
}

describe('rebuild.js vetTarget', () => {
  it('accepts a local TCP URL and points the admin connection at the maintenance database', () => {
    const r = vetTarget('postgresql://postgres:postgres@localhost:5434/trainingai_lane_a')
    expect(r.dbName).toBe('trainingai_lane_a')
    expect(r.adminUrl).toBe('postgresql://postgres:postgres@localhost:5434/postgres')
  })

  it('accepts 127.0.0.1, ::1 and a Unix-socket URL', () => {
    expect(vetTarget('postgresql://p:p@127.0.0.1:5433/trainingai_dev').dbName).toBe('trainingai_dev')
    expect(vetTarget('postgresql://p:p@[::1]:5433/trainingai_dev').dbName).toBe('trainingai_dev')
    const socket = vetTarget('postgresql://p:p@/trainingai_dev?host=/tmp&port=5433')
    expect(socket.dbName).toBe('trainingai_dev')
    // `setup.sh` writes this form. `new URL()` rejects it outright, which the first draft missed.
    expect(socket.adminUrl).toBe('postgresql://p:p@/postgres?host=/tmp&port=5433')
  })

  it('refuses a remote host — the Railway shapes that sit in a developer .env.local', () => {
    expect(() => vetTarget('postgresql://u:p@kodama.proxy.rlwy.net:16635/railway')).toThrow(/local servers only/)
    expect(() => vetTarget('postgresql://u:p@db.internal:5432/trainingai_dev')).toThrow(/local servers only/)
  })

  it('refuses a socket URL whose host parameter is a hostname', () => {
    expect(() => vetTarget('postgresql://u:p@/trainingai_dev?host=prod.example.com')).toThrow(/must name a directory/)
  })

  it('refuses the maintenance database, odd names, and nothing at all', () => {
    expect(() => vetTarget('postgresql://p:p@localhost:5434/postgres')).toThrow(/maintenance/)
    expect(() => vetTarget('postgresql://p:p@localhost:5434/x;DROP')).toThrow(/snake_case/)
    expect(() => vetTarget(undefined)).toThrow(/not set/)
    expect(() => vetTarget('mysql://p:p@localhost/x')).toThrow(/not a Postgres URL/)
  })
})
