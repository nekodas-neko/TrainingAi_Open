import { describe, it, expect } from 'vitest'
import { isDevAppId, DEV_APP_ID } from '../app-flavour'

describe('isDevAppId (#2390)', () => {
  it('is true only for the Dev flavour', () => {
    expect(isDevAppId('com.trainingai.app.dev')).toBe(true)
    expect(isDevAppId(DEV_APP_ID)).toBe(true)
  })

  it('is false for the real app, which must keep the update card and download', () => {
    expect(isDevAppId('com.trainingai.app')).toBe(false)
  })

  it('is false for anything unknown, so a failed lookup never hides the real app’s entries', () => {
    for (const id of [undefined, null, '', 'dev', 'com.trainingai.app.dev.other', 'COM.TRAININGAI.APP.DEV']) {
      expect(isDevAppId(id), String(id)).toBe(false)
    }
  })
})
