import { describe, it, expect } from 'vitest'
import { personalRecordReadings, trainingGroups, type PersonalRecordRow } from '../training-overview'

const rec = (name: string, oneRm: number, at: string): PersonalRecordRow =>
  ({ exerciseName: name, estimated1rm: oneRm, achievedAt: at })

describe('LB-95 — personal records as readings', () => {
  it('⛔ resolves the day in the USER’s zone, not UTC', () => {
    // 2026-09-29T23:30Z is already the 30th in Brisbane. Slicing the ISO string would print the
    // 29th — the exact off-by-one the timezone rule exists for, and it is wrong for every record
    // set before 10am local.
    const [r] = personalRecordReadings([rec('Squat', 140, '2026-09-29T23:30:00.000Z')], 'Australia/Brisbane')
    expect(r.asOf).toBe('2026-09-30')
    expect('2026-09-29T23:30:00.000Z'.slice(0, 10), 'the naive read this guards against').toBe('2026-09-29')
  })

  it('gives a different day for the same instant in a different zone', () => {
    const at = '2026-09-29T23:30:00.000Z'
    expect(personalRecordReadings([rec('Squat', 140, at)], 'Australia/Brisbane')[0].asOf).toBe('2026-09-30')
    expect(personalRecordReadings([rec('Squat', 140, at)], 'America/New_York')[0].asOf).toBe('2026-09-29')
  })

  it('labels the value as estimated, because it was computed and never lifted', () => {
    const [r] = personalRecordReadings([rec('Bench', 102.55, '2026-09-01T02:00:00.000Z')], 'Australia/Brisbane')
    expect(r).toMatchObject({ label: 'Bench', value: '102.6 kg', note: 'estimated 1RM' })
  })

  it('drops a record with no usable number rather than printing NaN kg', () => {
    expect(personalRecordReadings([
      rec('Squat', 0, '2026-09-01T02:00:00.000Z'),
      rec('Row', Number.NaN, '2026-09-01T02:00:00.000Z'),
      rec('Bench', 100, '2026-09-01T02:00:00.000Z'),
    ], 'Australia/Brisbane').map(r => r.label)).toEqual(['Bench'])
  })

  it('keeps the route’s order, which is newest first', () => {
    const rows = personalRecordReadings([
      rec('Squat', 140, '2026-09-20T02:00:00.000Z'),
      rec('Bench', 100, '2026-09-01T02:00:00.000Z'),
    ], 'Australia/Brisbane')
    expect(rows.map(r => r.label)).toEqual(['Squat', 'Bench'])
  })

  it('renders no group at all when there is nothing to show', () => {
    // The section returns null on an empty group list, so an account with no logged set gets no
    // empty card — the same shape the tests-and-scans section uses.
    expect(trainingGroups([], 'Australia/Brisbane')).toEqual([])
    expect(trainingGroups([rec('Squat', 0, '2026-09-01T02:00:00.000Z')], 'Australia/Brisbane')).toEqual([])
    expect(trainingGroups([rec('Squat', 140, '2026-09-01T02:00:00.000Z')], 'Australia/Brisbane'))
      .toEqual([{ title: 'Personal records', readings: [expect.objectContaining({ label: 'Squat' })] }])
  })
})
