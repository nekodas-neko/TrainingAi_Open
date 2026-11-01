import { describe, it, expect } from 'vitest'
import { OURA_STALE_AFTER_MS, ouraClock, ouraFeedStatus, ouraStaleLine } from '../oura-freshness'

const TZ = 'Australia/Brisbane' // UTC+10, no daylight saving
// 12:00 local on 26 Oct.
const NOW = Date.parse('2026-10-26T02:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const H = 60 * 60 * 1000

describe('ouraStaleLine', () => {
  it('says nothing while the data is within three hours, including exactly three', () => {
    expect(ouraStaleLine(ago(10 * 60 * 1000), NOW, TZ)).toBeNull()
    expect(ouraStaleLine(ago(OURA_STALE_AFTER_MS), NOW, TZ)).toBeNull()
  })

  it('names when it last updated once it is older, in the user\'s zone', () => {
    // 3 h 1 min before 12:00 local is 08:59.
    expect(ouraStaleLine(ago(OURA_STALE_AFTER_MS + 60_000), NOW, TZ)?.replace(/\s/g, ' ')).toBe('Oura · updated 8:59 am')
  })

  it('adds the date when the last update was not today', () => {
    expect(ouraStaleLine(ago(20 * H), NOW, TZ)?.replace(/\s/g, ' ')).toBe('Oura · updated 25 Oct, 4:00 pm')
  })

  it('anchors the day to the user\'s zone, not the phone\'s', () => {
    // 13:30 UTC on the 25th is 23:30 on the 25th in Brisbane, but 09:30 on the 26th in Auckland.
    const at = '2026-10-25T13:30:00.000Z'
    expect(ouraClock(at, NOW, TZ).replace(/\s/g, ' ')).toBe('25 Oct, 11:30 pm')
    expect(ouraClock(at, NOW, 'Pacific/Auckland').replace(/\s/g, ' ')).toBe('2:30 am')
  })

  it('says nothing with no data yet, a time it cannot read, or a time in the future', () => {
    expect(ouraStaleLine(null, NOW, TZ)).toBeNull()
    expect(ouraStaleLine(undefined, NOW, TZ)).toBeNull()
    expect(ouraStaleLine('not a date', NOW, TZ)).toBeNull()
    expect(ouraStaleLine(new Date(NOW + 5 * H).toISOString(), NOW, TZ)).toBeNull()
  })
})

describe('ouraFeedStatus', () => {
  it('prints the last data received and the last webhook', () => {
    expect(ouraFeedStatus({ lastDataAt: ago(2 * H), lastWebhookAt: ago(2 * H + 120_000) }, NOW, TZ).replace(/\s/g, ' '))
      .toBe('Last data received 10:00 am · last webhook 9:58 am')
  })

  it('says so for a time that has not happened', () => {
    expect(ouraFeedStatus({ lastDataAt: null, lastWebhookAt: undefined }, NOW, TZ))
      .toBe('No data received yet · no webhook yet')
  })
})
