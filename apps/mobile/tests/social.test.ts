import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { SocialActions } from '../src/features/social/data/SocialActions.ts';
import {
  feedSpec,
  friendProfileSpec,
  friendsSpec,
  leaderboardSpec,
  pendingRequests,
  rankLabel,
  rankValue,
  type Friendship,
} from '../src/features/social/data/models.ts';
import type { AccountConnection } from '../src/features/account/session.ts';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const own = id(1),
  friend = id(2);
const incoming = {
  id: id(10),
  requesterId: friend,
  addresseeId: own,
  status: 'pending' as const,
  createdAt: '2026-10-12T00:00:00Z',
  updatedAt: '2026-10-12T00:00:00Z',
  otherUser: {
    id: friend,
    displayName: 'Alex',
    name: null,
    avatar: null,
    friendCode: 'ALEX12',
    equippedTitle: null,
  },
};
const outgoing = {
  ...incoming,
  id: id(11),
  requesterId: own,
  addresseeId: friend,
  otherUser: { ...incoming.otherUser, displayName: null, friendCode: null },
};
function fixture() {
  const values = new Map<string, string>();
  let rows: Friendship[] = [incoming],
    fail = false;
  const calls: unknown[] = [];
  const storage = {
    get: async (k: string) => values.get(k) ?? null,
    set: async (k: string, v: string) => {
      values.set(k, v);
    },
    remove: async (k: string) => {
      values.delete(k);
    },
  };
  const connection: AccountConnection = {
    origin: 'https://example.com',
    userId: own,
    timezone: 'Australia/Brisbane',
    get: async (path) => {
      if (fail) {
        throw Error('Offline');
      }
      if (path === '/api/friends') {
        return { friendships: rows };
      }
      if (path === '/api/friends/feed') {
        return { events: [] };
      }
      if (path === '/api/friends/leaderboard') {
        return { entries: [] };
      }
      return {};
    },
    post: async (_, body) => {
      calls.push(body);
      rows = [outgoing];
      return { friendship: outgoing };
    },
    patch: async (_, body) => {
      calls.push(body);
      const row = { ...incoming, status: 'accepted' as const };
      rows = [];
      return { friendship: row };
    },
    delete: async (_, body) => {
      calls.push(body);
      rows = [];
      fail = true;
      return undefined;
    },
  };
  const resources = new WorkoutResources(storage, connection);
  return { resources, connection, calls, values, service: new SocialActions(resources) };
}
test('incoming requests and sent requests have distinct available actions', () => {
  const grouped = pendingRequests([incoming, outgoing]);
  assert.deepEqual(
    grouped.incoming.map((row) => row.id),
    [incoming.id],
  );
  assert.deepEqual(
    grouped.outgoing.map((row) => row.id),
    [outgoing.id],
  );
});
test('cannot accept a sent request as the requester', async () => {
  const f = fixture();
  await f.resources.replace(friendsSpec, { friendships: [outgoing] });
  await assert.rejects(
    f.service.change('accept', outgoing.id, outgoing),
    /waiting on your friend/,
  );
  assert.equal(f.calls.length, 0);
});
test('friend request preserves the server masked target', async () => {
  const f = fixture();
  await f.resources.load(friendsSpec);
  await f.service.change('add', '  ALEX12  ');
  assert.deepEqual(f.calls, [{ emailOrCode: 'ALEX12' }]);
  const row = f.resources.state(friendsSpec).data!.friendships[0];
  assert.equal(row.otherUser.displayName, null);
  assert.equal(row.otherUser.friendCode, null);
});
test('successful removal clears profile and foreign feed even when refresh fails', async () => {
  const f = fixture(),
    accepted = { ...incoming, status: 'accepted' as const };
  await f.resources.replace(friendsSpec, { friendships: [accepted] });
  await f.resources.replace(feedSpec, {
    events: [
      {
        type: 'achievement',
        userId: friend,
        displayName: 'Alex',
        avatar: null,
        equippedTitle: null,
        occurredAt: '2026-10-12T00:00:00Z',
        payload: { achievementName: 'Workout completed' },
      },
    ],
  });
  const row = {
    userId: friend,
    displayName: 'Alex',
    avatar: null,
    equippedTitle: null,
    isSelf: false,
    weeklySessions: 2,
    weeklyVolumeKg: 2000,
    weeklyStreak: 3,
    allTimeSessions: 12,
    allTimeVolumeKg: 12000,
    allTimeStreak: 5,
  };
  await f.resources.replace(leaderboardSpec, { entries: [row] });
  const profile = friendProfileSpec(friend);
  await f.resources.replace(profile, {
    id: friend,
    displayName: 'Alex',
    name: null,
    avatar: null,
    friendCode: 'ALEX12',
    equippedTitle: null,
    level: 1,
    levelLabel: 'Starter',
    xp: 0,
    currentLevelXp: 0,
    nextLevelXp: 100,
    lifetimeSessions: 12,
    lifetimeVolumeKg: 12000,
    bestStreak: 5,
    totalDistanceKm: 0,
    trophyCase: [],
    unlockedAchievementIds: [],
    achievements: [],
  });
  await f.service.change('remove', accepted.id, accepted);
  assert.deepEqual(f.resources.state(friendsSpec).data!.friendships, []);
  assert.deepEqual(f.resources.state(feedSpec).data!.events, []);
  assert.equal(f.resources.state(profile).data, null);
  assert.deepEqual(f.resources.state(leaderboardSpec).data!.entries, []);
  const reopened = new WorkoutResources(
    { get: async (k) => f.values.get(k) ?? null, set: async () => {}, remove: async () => {} },
    f.connection,
  );
  await reopened.load(friendsSpec, false, true);
  assert.deepEqual(reopened.state(friendsSpec).data!.friendships, []);
});
test('weekly streak ranks use weeks and all-time streaks use days', () => {
  const row = { weeklyStreak: 3, allTimeStreak: 9 } as Parameters<typeof rankValue>[0];
  assert.equal(rankValue(row, 'weekly', 'streak'), 3);
  assert.equal(rankLabel(3, 'weekly', 'streak'), '3 weeks');
  assert.equal(rankLabel(9, 'alltime', 'streak'), '9 days');
});
