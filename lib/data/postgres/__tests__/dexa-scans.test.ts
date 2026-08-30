// BF-41 / BF-2 — DEXA storage, tested against the real printout rather than a plausible one.
//
// The entry's rule is that a schema invented from a description drops the field that turns out to
// matter, so the fixture below is the owner's actual Hologic Horizon A report, de-identified, from
// `docs/clinical-baseline-2026-08-27.md`. **Every number here is one the report prints.** The
// round-trip test is therefore not ceremony: it is the only thing that can show "keep every field"
// (BF-43) actually held through a migration, a Drizzle schema, an insert, a select and a mapper —
// five places a column can be silently dropped, of which `rowToDexaScan` is the one CLAUDE.md
// names as failing silently as "save doesn't persist".
//
// Runs only against a real local dev Postgres — skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000d53a'
const OTHER = '00000000-0000-4000-8000-00000000d53b'

/** The 27 August 2026 report, in full. Grams are grams because that is how the printout reads. */
const REPORT = {
  scannedOn: '2026-08-27',
  manufacturer: 'Hologic',
  model: 'Horizon A',
  serialNumber: '307883M',
  scanType: 'Auto Whole Body Fan Beam',
  analysisVersion: '13.6.1.3',
  providerScanId: 'A08272607',
  heightCm: 158.1,
  weightKg: 72.1,
  ageYears: 33,
  bmi: 28.8,
  totalBmd: 1.046,
  tScore: -1.6,
  zScore: -1.6,
  totalBmcG: 1927.25,
  bmdPrecisionCvPct: 1.0,
  fatG: 20547.5,
  leanG: 49532.8,
  leanPlusBmcG: 51460.1,
  totalMassG: 72007.6,
  pctFat: 28.5,
  pctFatYoungNormal: 93,
  pctFatAgeMatched: 89,
  androidPctFat: 36.0,
  gynoidPctFat: 30.3,
  fatMassHeight2: 8.22,
  androidGynoidRatio: 1.19,
  pctFatTrunkLegs: 0.98,
  trunkLimbFatMassRatio: 0.99,
  vatMassG: 305,
  vatVolumeCm3: 330,
  vatAreaCm2: 63.3,
  leanHeight2: 19.8,
  appendicularLeanHeight2: 9.46,
  boneReference: 'White Male, 2012 BMDCS/NHANES',
  bodyCompReference: 'AIMSS',
  source: 'manual' as const,
  notes: null,
}

/** The provider's own row set, aggregates included. Values are illustrative shapes; the report
 *  prints per-region BMD/BMC/Area and what is being tested here is that N rows survive as N rows. */
const REGIONS = [
  { region: 'L Arm', bmd: 0.72, bmcG: 118.4, areaCm2: 164.4 },
  { region: 'R Arm', bmd: 0.74, bmcG: 122.7, areaCm2: 165.8 },
  { region: 'L Ribs', bmd: 0.62, bmcG: 89.1, areaCm2: 143.7 },
  { region: 'R Ribs', bmd: 0.63, bmcG: 91.5, areaCm2: 145.2 },
  { region: 'T Spine', bmd: 0.79, bmcG: 131.0, areaCm2: 165.8 },
  { region: 'L Spine', bmd: 0.94, bmcG: 66.2, areaCm2: 70.4 },
  { region: 'Pelvis', bmd: 1.02, bmcG: 296.5, areaCm2: 290.7 },
  { region: 'L Leg', bmd: 1.15, bmcG: 361.9, areaCm2: 314.7 },
  { region: 'R Leg', bmd: 1.16, bmcG: 366.2, areaCm2: 315.6 },
  { region: 'Subtotal', bmd: 0.95, bmcG: 1443.5, areaCm2: 1519.3 },
  { region: 'Head', bmd: 2.11, bmcG: 483.8, areaCm2: 229.3 },
  { region: 'Total', bmd: 1.046, bmcG: 1927.25, areaCm2: 1748.6 },
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

  it('round-trips every field of the real report', async () => {
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
    expect(leg).toEqual({ region: 'L Leg', bmd: 1.15, bmcG: 361.9, areaCm2: 314.7 })
  })

  // A T-score below zero is the ordinary case, not an edge one — the owner's is −1.6. Storing it as
  // a positive (or refusing it) would misread osteopenia as normal bone.
  it('keeps negative T and Z scores negative', async () => {
    await repo.saveDexaScan(USER, { ...REPORT, regions: [] })
    const row = await repo.getLatestDexaScan(USER)
    expect(row!.tScore).toBe(-1.6)
    expect(row!.zScore).toBe(-1.6)
  })

  describe('re-entering the same scan', () => {
    it('updates in place rather than duplicating the day', async () => {
      await repo.saveDexaScan(USER, { ...REPORT, regions: REGIONS })
      await repo.saveDexaScan(USER, { ...REPORT, pctFat: 29.1, regions: REGIONS })

      const all = await repo.listDexaScans(USER)
      expect(all).toHaveLength(1)
      expect(all[0].pctFat).toBe(29.1)
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
      await repo.saveDexaScan(USER, { ...REPORT, pctFat: 28.5, regions: [] })
      await repo.saveDexaScan(OTHER, { ...REPORT, pctFat: 11.2, regions: [] })

      expect((await repo.getLatestDexaScan(USER))!.pctFat).toBe(28.5)
      expect((await repo.getLatestDexaScan(OTHER))!.pctFat).toBe(11.2)
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
      await repo.saveDexaScan(USER, { ...REPORT, scannedOn: '2025-02-11', regions: REGIONS.slice(0, 2) })
      await repo.saveDexaScan(USER, { ...REPORT, scannedOn: '2026-08-27', regions: REGIONS })

      const [newest, oldest] = await repo.listDexaScans(USER)
      expect(newest.regions).toHaveLength(REGIONS.length)
      expect(oldest.regions.map(r => r.region)).toEqual(['L Arm', 'R Arm'])
    })
  })

  it('lists newest first, which is what a calibration series is read in', async () => {
    await repo.saveDexaScan(USER, { ...REPORT, scannedOn: '2025-02-11', pctFat: 31.0, regions: [] })
    await repo.saveDexaScan(USER, { ...REPORT, scannedOn: '2026-08-27', pctFat: 28.5, regions: [] })
    await repo.saveDexaScan(USER, { ...REPORT, scannedOn: '2025-09-30', pctFat: 29.8, regions: [] })

    expect((await repo.listDexaScans(USER)).map(r => r.scannedOn))
      .toEqual(['2026-08-27', '2025-09-30', '2025-02-11'])
    expect((await repo.getLatestDexaScan(USER))!.scannedOn).toBe('2026-08-27')
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
      const sql = readFileSync('lib/data/postgres/migrations/241_claude_ro_views_dexa.sql', 'utf8')
      const view = sql.slice(sql.indexOf('CREATE VIEW claude_ro.dexa_scan_regions'))
      expect(view.slice(0, view.indexOf(';'))).toContain(
        'EXISTS (SELECT 1 FROM public.dexa_scans d WHERE d.id = t.scan_id')
    })
  })
})
