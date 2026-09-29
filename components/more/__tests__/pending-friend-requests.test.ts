import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { splitPendingRequests } from '@/components/more/pending-friend-requests'
import { stripComments } from '../../../scripts/lib/strip-comments.js'
import type { Friendship } from '@trainingai/shared/types/friends'

const ME = 'me-uuid'
const THEM = 'them-uuid'

const row = (over: Partial<Friendship> & { otherUserId: string }): Friendship => ({
  id: 'f1',
  requesterId: ME,
  addresseeId: THEM,
  status: 'pending',
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
  ...over,
  otherUser: {
    id: over.otherUserId,
    displayName: null,
    name: null,
    avatar: null,
    friendCode: null,
    equippedTitle: null,
  },
})

describe('splitPendingRequests — LA-181', () => {
  it('calls it outgoing when the other person is the addressee', () => {
    // I am the requester, so `otherUser` is who I sent it TO — and RV-195 has blanked their details.
    const { incoming, outgoing } = splitPendingRequests([row({ otherUserId: THEM })])
    expect(outgoing).toHaveLength(1)
    expect(incoming).toHaveLength(0)
  })

  it('calls it incoming when the other person is the requester', () => {
    const { incoming, outgoing } = splitPendingRequests([
      row({ otherUserId: THEM, requesterId: THEM, addresseeId: ME }),
    ])
    expect(incoming).toHaveLength(1)
    expect(outgoing).toHaveLength(0)
  })

  it('needs no viewer id and no name to tell them apart', () => {
    // Both rows below are fully masked — the whole point is that the id on `otherUser` survives
    // masking, so direction never depends on a name or on who is signed in.
    const { incoming, outgoing } = splitPendingRequests([
      row({ id: 'sent', otherUserId: THEM }),
      row({ id: 'got', otherUserId: THEM, requesterId: THEM, addresseeId: ME }),
    ])
    expect(outgoing.map(f => f.id)).toEqual(['sent'])
    expect(incoming.map(f => f.id)).toEqual(['got'])
  })

  it('drops accepted friendships and the self-edge the old filter also dropped', () => {
    const { incoming, outgoing } = splitPendingRequests([
      row({ otherUserId: THEM, status: 'accepted' }),
      row({ otherUserId: ME, requesterId: ME, addresseeId: ME }),
    ])
    expect(incoming).toHaveLength(0)
    expect(outgoing).toHaveLength(0)
  })
})

describe('the sheet and the badge read the same split — LA-181', () => {
  // Comments stripped: this file's prose names the symbols it forbids.
  const read = (rel: string) => stripComments(readFileSync(path.join(process.cwd(), rel), 'utf8'))
  const sheet = read('components/more/manage-friends-sheet.tsx')
  const tab = read('components/more/friends-tab.tsx')

  it('gives Accept/Decline to incoming rows only', () => {
    expect(sheet).toMatch(/\{incoming\.map\(f => \(/)
    expect(sheet).not.toMatch(/\{pending\.map/)
    // The old filter is gone from both, so neither can drift back to counting both directions.
    expect(sheet).not.toMatch(/status === 'pending' && f\.addresseeId !== f\.requesterId/)
    expect(tab).not.toMatch(/filter\(f => f\.status === 'pending'\)/)
  })

  it('offers a Cancel on a request you sent, and no Accept', () => {
    expect(sheet).toMatch(/\{outgoing\.map\(f => \(/)
    expect(sheet).toMatch(/aria-label="Cancel request"/)
    expect(sheet).toMatch(/Request cancelled/)
  })

  it('counts only what the user can act on in the badge', () => {
    expect(tab).toMatch(/splitPendingRequests\(friendships\)\.incoming\.length/)
  })
})
