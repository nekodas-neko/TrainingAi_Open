import { describe, it, expect } from 'vitest'
import { strapLinkLabel } from '../strap-link-label'

describe('strapLinkLabel', () => {
  it('reports a live, worn link', () => {
    expect(strapLinkLabel({ gattConnected: true, worn: true, active: true, state: 'ready' }))
      .toBe('Connected · on your chest')
  })

  it('explains a linked but unworn strap', () => {
    expect(strapLinkLabel({ gattConnected: true, worn: false, active: true, state: 'ready' }))
      .toBe('Connected · no chest contact (ring takes over)')
  })

  it('says connecting only while a connection is genuinely in progress', () => {
    expect(strapLinkLabel({ gattConnected: false, worn: true, active: true, state: 'connecting' }))
      .toBe('Connecting…')
    expect(strapLinkLabel({ gattConnected: false, worn: true, active: true, state: 'preparing' }))
      .toBe('Connecting…')
  })

  // The bug: every non-ready state read as "Connecting…" forever, including after the native
  // service had given up entirely (owner report, 2026-08-02).
  it('says retrying while the service is between attempts', () => {
    expect(strapLinkLabel({ gattConnected: false, worn: true, active: true, state: 'disconnected' }))
      .toBe('Strap not reachable — retrying')
    expect(strapLinkLabel({ gattConnected: false, worn: true, active: true, state: 'idle' }))
      .toBe('Strap not reachable — retrying')
    expect(strapLinkLabel({ gattConnected: false, worn: true, active: true, state: 'closed' }))
      .toBe('Strap not reachable — retrying')
  })

  it('says not connected once the service has stopped', () => {
    expect(strapLinkLabel({ gattConnected: false, worn: true, active: true, state: 'stopped' }))
      .toBe('Not connected — tap Connect, or it connects during workouts')
  })

  it('says not connected when nothing is running at all', () => {
    expect(strapLinkLabel({ gattConnected: false, worn: true, active: false, state: 'stopped' }))
      .toBe('Not connected — tap Connect, or it connects during workouts')
  })

  // A live link is reported as such regardless of what the service last said about itself —
  // gattConnected is the raw truth and outranks the state machine.
  it('trusts a live link over a stale service state', () => {
    expect(strapLinkLabel({ gattConnected: true, worn: true, active: false, state: 'stopped' }))
      .toBe('Connected · on your chest')
  })
})
