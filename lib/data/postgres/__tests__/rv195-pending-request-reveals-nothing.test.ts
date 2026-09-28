// RV-195 ③ — a pending friend request must not hand the SENDER the target's profile.
//
// Sending a request by email returned the target's name, avatar and friend code straight away, so
// any account could probe an email address and get a profile back. Until the request is accepted
// the sender sees only what they typed; the addressee still sees the sender in full, because the
// sender chose to reveal themselves and the addressee needs it to decide.
//
// Runs only against a real local dev Postgres; skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const SENDER = '00000000-0000-4000-8000-000000195c01'
const TARGET = '00000000-0000-4000-8000-000000195c02'

describe.skipIf(!canRun)('a pending friend request reveals nothing to its sender (RV-195)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(`DELETE FROM friendships WHERE requester_id = ANY($1::uuid[]) OR addressee_id = ANY($1::uuid[])`, [[SENDER, TARGET]])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, name, display_name, avatar, friend_code)
       VALUES ($1, 'rv195-sender@example.com', 'x', 'Australia/Brisbane', 'Sender Real', 'Sender', 'data:image/png;base64,AAAA', 'RV195SND'),
              ($2, 'rv195-target@example.com', 'x', 'Australia/Brisbane', 'Target Real', 'Target', 'data:image/png;base64,BBBB', 'RV195TGT')
       ON CONFLICT (id) DO NOTHING`, [SENDER, TARGET])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM friendships WHERE requester_id = ANY($1::uuid[]) OR addressee_id = ANY($1::uuid[])`, [[SENDER, TARGET]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[SENDER, TARGET]])
  })

  it('masks the target for the sender, shows the sender to the target, and unmasks on accept', async () => {
    const sent = await repo.sendFriendRequest(SENDER, 'RV195-Target@Example.com')
    expect(sent.otherUser).toEqual({
      id: TARGET, displayName: 'RV195-Target@Example.com', name: null, avatar: null, friendCode: null, equippedTitle: null,
    })

    const senderView = (await repo.listFriendships(SENDER)).find(f => f.id === sent.id)!
    expect(JSON.stringify(senderView)).not.toMatch(/Target Real|BBBB|RV195TGT/)

    const targetView = (await repo.listFriendships(TARGET)).find(f => f.id === sent.id)!
    expect(targetView.otherUser).toMatchObject({ name: 'Sender Real', friendCode: 'RV195SND' })

    await repo.acceptFriendRequest(sent.id, TARGET)
    const afterAccept = (await repo.listFriendships(SENDER)).find(f => f.id === sent.id)!
    expect(afterAccept.otherUser).toMatchObject({ name: 'Target Real', friendCode: 'RV195TGT' })
  })
})
