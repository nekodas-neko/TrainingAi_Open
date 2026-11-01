import { describe, expect, it, vi } from 'vitest'

const report = vi.hoisted(() => vi.fn())
vi.mock('../report', () => ({ reportOuraCloudIssue: report }))

import { stampOuraData, stampOuraWebhook } from '../freshness'

describe('Oura feed stamps (#2861)', () => {
  it('writes the webhook and data stamps for the user', async () => {
    const touchOuraCloudWebhook = vi.fn(async () => {})
    const touchOuraCloudData = vi.fn(async () => {})
    await stampOuraWebhook({ touchOuraCloudWebhook }, 'u1')
    await stampOuraData({ touchOuraCloudData }, 'u1')
    expect(touchOuraCloudWebhook).toHaveBeenCalledExactlyOnceWith('u1')
    expect(touchOuraCloudData).toHaveBeenCalledExactlyOnceWith('u1')
  })

  it('never throws: a failed stamp is reported with a reason and the delivery carries on', async () => {
    await expect(stampOuraWebhook({ touchOuraCloudWebhook: async () => { throw new Error('db down') } }, 'u1')).resolves.toBeUndefined()
    await expect(stampOuraData({ touchOuraCloudData: async () => { throw new Error('db down') } }, 'u1')).resolves.toBeUndefined()
    expect(report).toHaveBeenCalledWith('freshness:webhook', 'db down', { userId: 'u1' })
    expect(report).toHaveBeenCalledWith('freshness:data', 'db down', { userId: 'u1' })
  })
})
