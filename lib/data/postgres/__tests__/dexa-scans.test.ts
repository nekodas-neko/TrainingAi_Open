// BF-41 / BF-2 — DEXA storage, round-tripped field by field.
//
// The entry's rule is that a schema invented from a description drops the field that turns out to
// matter, so the fixture below fills **every field the table has**. It is synthetic: round numbers,
// a made-up serial and scan id, and no one's record. It is internally consistent (fat + lean + BMC
// is the total mass, and BMI and the /height² indices follow from the stated height and masses) so
// it reads like a printout without being one. The round-trip test is therefore not ceremony: it is
// the only thing that can show "keep every field" (BF-43) actually held through a migration, a
// Drizzle schema, an insert, a select and a mapper — five places a column can be silently dropped,
// of which `rowToDexaScan` is the one CLAUDE.md names as failing silently as "save doesn't persist".
//
// Runs only against a real local dev Postgres — skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000d53a'
const OTHER = '00000000-0000-4000-8000-00000000d53b'

/** A synthetic report with every field filled. Grams are grams, as a printout reads them.
 *  200 cm makes height² exactly 4 m², so the indices below are the masses in kg divided by 4. */
const REPORT = {
  scannedOn: '2026-01-15',
  manufacturer: 'Example Medical',
  model: 'DX-1000',
  serialNumber: 'TEST0001',
  scanType: 'Whole Body',
  analysisVersion: '1.0.0',
  providerScanId: 'SCAN-TEST-1',
  heightCm: 200,
  weightKg: 80,
  ageYears: 40,
  bmi: 20, // 80 / 2.0²
  totalBmd: 1.2,
  tScore: -1.0,
  zScore: -0.5,
  totalBmcG: 3600,
  bmdPrecisionCvPct: 1.5,
  fatG: 16000,
  leanG: 60400,
  leanPlusBmcG: 64000, // 60400 + 3600
  totalMassG: 80000, // 16000 + 64000
  pctFat: 20, // 16000 / 80000
  pctFatYoungNormal: 50,
  pctFatAgeMatched: 50,
  androidPctFat: 25,
  gynoidPctFat: 20,
  fatMassHeight2: 4, // 16 kg / 4 m²
  androidGynoidRatio: 1.25, // 25 / 20
  pctFatTrunkLegs: 1.1,
  trunkLimbFatMassRatio: 1.2,
  vatMassG: 500,
  vatVolumeCm3: 532, // 500 g at 0.94 g/cm³
  vatAreaCm2: 100,
  leanHeight2: 15.1, // 60.4 kg / 4 m²
  appendicularLeanHeight2: 7, // 28 kg / 4 m²
  boneReference: 'Test reference (bone)',
  bodyCompReference: 'Test reference (body composition)',
  source: 'manual' as const,
  notes: null,
}

/** A full region set, aggregates included, in synthetic round numbers. Each row's BMD is its BMC
 *  over its area, the nine regions sum to Subtotal, and Subtotal plus Head is the Total the report
 *  above carries. What is being tested is that N rows survive as N rows. */
const REGIONS = [
  { region: 'L Arm', bmd: 0.75, bmcG: 150, areaCm2: 200 },
  { region: 'R Arm', bmd: 0.75, bmcG: 150, areaCm2: 200 },
  { region: 'L Ribs', bmd: 0.7, bmcG: 140, areaCm2: 200 },
  { region: 'R Ribs', bmd: 0.7, bmcG: 140, areaCm2: 200 },
  { region: 'T Spine', bmd: 1.0, bmcG: 200, areaCm2: 200 },
  { region: 'L Spine', bmd: 0.9, bmcG: 90, areaCm2: 100 },
  { region: 'Pelvis', bmd: 1.1, bmcG: 330, areaCm2: 300 },
  { region: 'L Leg', bmd: 1.2, bmcG: 600, areaCm2: 500 },
  { region: 'R Leg', bmd: 1.2, bmcG: 600, areaCm2: 500 },
  { region: 'Subtotal', bmd: 1.0, bmcG: 2400, areaCm2: 2400 },
  { region: 'Head', bmd: 2.0, bmcG: 1200, areaCm2: 600 },
  { region: 'Total', bmd: 1.2, bmcG: 3600, areaCm2: 3000 },
]

describe.skipIf(!canRun)('DEXA scan storage (BF-41 / BF-2)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const id of [USER, OTHER]) {
      // Email derived from the id — a hardcoded one left behind after a rename fails
      // `users_email_unique` under the new id (LA-32).
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `dexa-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM dexa_scans WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  beforeEach(async () => {
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM dexa_scans WHERE user_id = $1`, [id])
    }
  })

  it('round-trips every field of a full report', async () => {
    await repo.saveDexaScan(USER, { ...REPORT, regions: REGIONS })
    const row = await repo.getLatestDexaScan(USER)
    expect(row).not.toBeNull()

    // Field by field, from the fixture rather than a repeated literal list — a new column added to
    // the migration and forgotten in `rowToDexaScan` fails here without anyone updating this test.
    for (const [key, want] of Object.entries(REPORT)) {
      expect({ [key]: (row as unknown as Record<string, unknown>)[key] }).toEqual({ [key]: want })
    }
  })

  // The point of `keep every field`: the mapper is where a column goes missing without an error.
  it('exposes a key for every column the table has, so a dropped mapper field is visible', async () => {
    await repo.saveDexaScan(USER, { ...REPORT, regions: REGIONS })
    const row = (await repo.getLatestDexaScan(USER)) as unknown as Record<string, unknown>

    const { rows: cols } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'dexa_scans'`)
    const camel = (c: string) => c.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase())
    // `user_id` is the scope, not data, and the timestamps are provenance the callers do not read.
    const skip = new Set(['user_id', 'created_at', 'updated_at'])
    const missing = cols.map(c => c.column_name).filter(c => !skip.has(c) && !(camel(c) in row))
    expect(missing).toEqual([])
  })

  it('stores the whole region set, aggregates included, and reads it back', async () => {
    await repo.saveDexaScan(USER, { ...REPORT, regions: REGIONS })
    const row = await repo.getLatestDexaScan(USER)
    expect(row!.regions).toHaveLength(REGIONS.length)
    expect(new Set(row!.regions.map(r => r.region))).toEqual(new Set(REGIONS.map(r => r.region)))
    const leg = row!.regions.find(r => r.region === 'L Leg')!
    expect(leg).toEqual({ region: 'L Leg', bmd: 1.2, bmcG: 600, areaCm2: 500 })
  })

  // A T-score below zero is the ordinary case, not an edge one — anything under −1 already reads as
  // low bone density. Storing it as a positive (or refusing it) would misread osteopenia as normal
  // bone. T and Z differ in the fixture so a swapped column fails too.
  it('keeps negative T and Z scores negative', async () => {
    await repo.saveDexaScan(USER, { ...REPORT, regions: [] })
    const row = await repo.getLatestDexaScan(USER)
    expect(row!.tScore).toBe(-1.0)
    expect(row!.zScore).toBe(-0.5)
  })

  describe('re-entering the same scan', () => {
    it('updates in place rather than duplicating the day', async () => {
      await repo.saveDexaScan(USER, { ...REPORT, regions: REGIONS })
      await repo.saveDexaScan(USER, { ...REPORT, pctFat: 25, regions: REGIONS })

      const all = await repo.listDexaScans(USER)
      expect(all).toHaveLength(1)
      expect(all[0].pctFat).toBe(25)
    })

    // Regions are REPLACED, not merged: a re-extraction that reads ten regions instead of twelve
    // must leave ten, or the scan keeps two rows from a parse nobody confirmed.
    it('replaces the region set instead of accumulating it', async () => {
      await repo.saveDexaScan(USER, { ...REPORT, regions: REGIONS })
      await repo.saveDexaScan(USER, { ...REPORT, regions: REGIONS.slice(0, 3) })

      const row = await repo.getLatestDexaScan(USER)
      expect(row!.regions).toHaveLength(3)

      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM dexa_scan_regions r
         JOIN dexa_scans d ON d.id = r.scan_id WHERE d.user_id = $1`, [USER])
      expect(rows[0].n).toBe('3')
    })

    it('clears the regions when a re-save carries none', async () => {
      await repo.saveDexaScan(USER, { ...REPORT, regions: REGIONS })
      await repo.saveDexaScan(USER, { ...REPORT })
      expect((await repo.getLatestDexaScan(USER))!.regions).toEqual([])
    })
  })

  describe('scoping', () => {
    // The unique index is (user_id, scanned_on), so the conflict target can only ever match this
    // user's row. Two people scanned on the same day is otherwise one person overwriting the other.
    it('lets two users hold a scan for the same date', async () => {
      await repo.saveDexaScan(USER, { ...REPORT, pctFat: 20, regions: [] })
      await repo.saveDexaScan(OTHER, { ...REPORT, pctFat: 30, regions: [] })

      expect((await repo.getLatestDexaScan(USER))!.pctFat).toBe(20)
      expect((await repo.getLatestDexaScan(OTHER))!.pctFat).toBe(30)
    })

    it('never lists another user’s scans', async () => {
      await repo.saveDexaScan(OTHER, { ...REPORT, regions: REGIONS })
      expect(await repo.listDexaScans(USER)).toEqual([])
      expect(await repo.getLatestDexaScan(USER)).toBeNull()
    })

    // `listDexaScans` batches every scan's regions into one `inArray` read. A missing user scope on
    // the parent query would show up here as somebody else's leg arriving attached to this user's.
    it('does not attach another user’s regions when batching', async () => {
      await repo.saveDexaScan(OTHER, { ...REPORT, regions: REGIONS })
      await repo.saveDexaScan(USER, { ...REPORT, regions: REGIONS.slice(0, 2) })

      const mine = await repo.listDexaScans(USER)
      expect(mine).toHaveLength(1)
      expect(mine[0].regions).toHaveLength(2)
    })

    // The other half of the same batching risk, and the one a single-scan user cannot show: with
    // two scans in one `inArray` read, every region row has to land on the scan it belongs to. A
    // mutation that hands the whole batch to every scan passes the test above and fails this one.
    it('gives each of a user’s own scans only its own regions', async () => {
      await repo.saveDexaScan(USER, { ...REPORT, scannedOn: '2024-01-15', regions: REGIONS.slice(0, 2) })
      await repo.saveDexaScan(USER, { ...REPORT, scannedOn: '2026-01-15', regions: REGIONS })

      const [newest, oldest] = await repo.listDexaScans(USER)
      expect(newest.regions).toHaveLength(REGIONS.length)
      expect(oldest.regions.map(r => r.region)).toEqual(['L Arm', 'R Arm'])
    })
  })

  it('lists newest first, which is what a calibration series is read in', async () => {
    // Inserted out of order on purpose: oldest, newest, then the middle one.
    await repo.saveDexaScan(USER, { ...REPORT, scannedOn: '2024-01-15', pctFat: 30, regions: [] })
    await repo.saveDexaScan(USER, { ...REPORT, scannedOn: '2026-01-15', pctFat: 20, regions: [] })
    await repo.saveDexaScan(USER, { ...REPORT, scannedOn: '2025-01-15', pctFat: 25, regions: [] })

    expect((await repo.listDexaScans(USER)).map(r => r.scannedOn))
      .toEqual(['2026-01-15', '2025-01-15', '2024-01-15'])
    expect((await repo.getLatestDexaScan(USER))!.scannedOn).toBe('2026-01-15')
  })

  it('takes regions with a scan and drops them with it', async () => {
    await repo.saveDexaScan(USER, { ...REPORT, regions: REGIONS })
    await pool.query(`DELETE FROM dexa_scans WHERE user_id = $1`, [USER])
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM dexa_scan_regions r
       WHERE NOT EXISTS (SELECT 1 FROM dexa_scans d WHERE d.id = r.scan_id)`)
    expect(rows[0].n).toBe('0')
  })

  // Migration 241. The schema is default-deny, so a new table with no view is a table no session can
  // audit — and `dexa_scan_regions` has no `user_id`, which is the case the generator refuses to
  // guess at. It failed closed on this table until the FK path was registered, which is why the
  // check is here rather than assumed.
  describe('the claude_ro audit views', () => {
    it('exist for both tables', async () => {
      const { rows } = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.views
         WHERE table_schema = 'claude_ro' AND table_name LIKE 'dexa%' ORDER BY 1`)
      expect(rows.map(r => r.table_name)).toEqual(['dexa_scan_regions', 'dexa_scans'])
    })

    // The predicate the generator emits for the child, run against real rows: a region belonging to
    // a scan the owner does not own must not be reachable through it.
    it('scope the child through its parent’s owner, not through nothing', async () => {
      await repo.saveDexaScan(USER, { ...REPORT, regions: REGIONS })
      await repo.saveDexaScan(OTHER, { ...REPORT, regions: REGIONS })

      const predicate = `EXISTS (SELECT 1 FROM public.dexa_scans d WHERE d.id = t.scan_id AND d.user_id = $1)`
      const mine = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.dexa_scan_regions t WHERE ${predicate}`, [USER])
      expect(mine.rows[0].n).toBe(String(REGIONS.length))

      const theirs = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.dexa_scan_regions t
         WHERE (${predicate}) AND EXISTS (
           SELECT 1 FROM public.dexa_scans d WHERE d.id = t.scan_id AND d.user_id = $2)`,
        [USER, OTHER])
      expect(theirs.rows[0].n).toBe('0')
    })

    it('emits that predicate rather than an unscoped view', async () => {
      const { readFileSync } = await import('node:fs')
      const sql = readFileSync('lib/data/postgres/claude-ro-views.sql', 'utf8')
      const view = sql.slice(sql.indexOf('CREATE VIEW claude_ro.dexa_scan_regions'))
      expect(view.slice(0, view.indexOf(';'))).toContain(
        'EXISTS (SELECT 1 FROM public.dexa_scans d WHERE d.id = t.scan_id')
    })
  })
})
