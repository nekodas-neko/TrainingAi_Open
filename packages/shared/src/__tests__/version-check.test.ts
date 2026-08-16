import { describe, it, expect } from 'vitest'
import { isUpdateAvailable, resolveUpdateState } from '../version-check'

describe('isUpdateAvailable', () => {
  it('is true when the latest patch is ahead', () => {
    expect(isUpdateAvailable('1.108.0', '1.109.0')).toBe(true)
  })

  it('is true when the latest minor is ahead', () => {
    expect(isUpdateAvailable('1.108.5', '1.109.0')).toBe(true)
  })

  it('is true when the latest major is ahead', () => {
    expect(isUpdateAvailable('1.108.0', '2.0.0')).toBe(true)
  })

  it('is false when versions are equal', () => {
    expect(isUpdateAvailable('1.109.0', '1.109.0')).toBe(false)
  })

  it('is false when current is ahead of latest', () => {
    expect(isUpdateAvailable('1.110.0', '1.109.0')).toBe(false)
  })

  it('handles differing segment counts', () => {
    expect(isUpdateAvailable('1.109', '1.109.1')).toBe(true)
    expect(isUpdateAvailable('1.109.0', '1.109')).toBe(false)
  })
})

describe('resolveUpdateState', () => {
  it('reports an update only when the installed APK is behind the newest published one', () => {
    expect(resolveUpdateState('1.252.9', '1.255.1')).toBe('update')
  })

  it('reports up to date when they match — the positive confirmation the card never had', () => {
    expect(resolveUpdateState('1.255.1', '1.255.1')).toBe('current')
  })

  it('reports up to date for a locally-built APK that is ahead', () => {
    expect(resolveUpdateState('1.256.0', '1.255.1')).toBe('current')
  })

  it('reports unknown when the lookup failed, never up to date', () => {
    // A false all-clear is as bad as the false alarm this replaced: the owner would have no
    // signal at all that a genuine native build was waiting.
    expect(resolveUpdateState('1.255.1', null)).toBe('unknown')
    expect(resolveUpdateState('1.255.1', undefined)).toBe('unknown')
    expect(resolveUpdateState(null, '1.255.1')).toBe('unknown')
  })

  it('does not report an update for a JS-only release the WebView already has', () => {
    // The whole point: the server moved to 1.260.0 but no new APK was published, so the newest
    // APK is still the installed one. Comparing against the server version is what lit this up.
    expect(resolveUpdateState('1.255.1', '1.255.1')).toBe('current')
  })
})
