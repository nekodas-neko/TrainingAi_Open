import { z } from 'zod';
import type { WorkoutResources } from '../../workouts/data/WorkoutResources.ts';
import { ApiError } from '../../account/api/client.ts';
import {
  feedSpec,
  friendProfileSpec,
  friendsSpec,
  friendshipSchema,
  leaderboardSpec,
  type Friendship,
} from './models.ts';
const paths = ['/api/friends', '/api/friends/feed', '/api/friends/leaderboard'];
export class SocialActions {
  private running = false;
  constructor(private resources: WorkoutResources) {}
  async change(kind: 'add' | 'accept' | 'decline' | 'remove', value: string, row?: Friendship) {
    if (this.running) {
      throw new Error('A friend change is already in progress.');
    }
    this.running = true;
    try {
      if (kind === 'add') {
        z.string().trim().min(1).max(320).parse(value);
      }
      if (kind !== 'add' && (!row || row.id !== value)) {
        throw new Error('Refresh your friends and try again.');
      }
      if (
        ['accept', 'decline'].includes(kind) &&
        row?.addresseeId !== this.resources.connection.userId
      ) {
        throw new Error('This request is waiting on your friend.');
      }
      const before = this.resources.state(friendsSpec).data?.friendships ?? [];
      const response = await this.resources.write(
        kind === 'add' ? 'POST' : kind === 'remove' ? 'DELETE' : 'PATCH',
        kind === 'add' ? '/api/friends' : `/api/friends/${z.uuid().parse(value)}`,
        kind === 'add'
          ? { emailOrCode: value.trim() }
          : kind === 'remove'
            ? undefined
            : { action: kind },
        paths,
      );
      const changed =
        kind === 'add' || kind === 'accept'
          ? friendshipSchema.parse(
              z.object({ friendship: friendshipSchema }).parse(response).friendship,
            )
          : null;
      if (
        changed &&
        changed.requesterId !== this.resources.connection.userId &&
        changed.addresseeId !== this.resources.connection.userId
      ) {
        throw new Error('The request response belongs to another account.');
      }
      if (kind === 'accept' && (changed?.id !== row?.id || changed?.status !== 'accepted')) {
        throw new Error('Acceptance was not confirmed. Refresh and retry.');
      }
      const next = changed
        ? [...before.filter((item) => item.id !== changed.id), changed]
        : before.filter((item) => item.id !== row!.id);
      const cleanup: Promise<void>[] = [
        this.resources.replace(friendsSpec, { friendships: next }),
      ];
      if ((kind === 'remove' || kind === 'decline') && row) {
        const feed = this.resources.state(feedSpec).data;
        const leaderboard = this.resources.state(leaderboardSpec).data;
        if (feed) {
          cleanup.push(
            this.resources.replace(feedSpec, {
              events: feed.events.filter((event) => event.userId !== row.otherUser.id),
            }),
          );
        }
        if (leaderboard) {
          cleanup.push(
            this.resources.replace(leaderboardSpec, {
              entries: leaderboard.entries.filter((entry) => entry.userId !== row.otherUser.id),
            }),
          );
        }
        if (z.uuid().safeParse(row.otherUser.id).success) {
          cleanup.push(this.resources.forget(friendProfileSpec(row.otherUser.id)));
        }
      }
      const updated = await Promise.allSettled(cleanup);
      await Promise.all([
        this.resources.load(friendsSpec, true),
        this.resources.load(feedSpec, true),
        this.resources.load(leaderboardSpec, true),
      ]);
      if (updated.some((result) => result.status === 'rejected')) {
        throw new Error(
          'The friendship changed, but some saved views could not be updated. Refresh when connected.',
        );
      }
      return changed;
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(
          error.status === 429
            ? 'Too many requests. Please wait before trying again.'
            : kind === 'add'
              ? 'Check the email or friend code, and review any existing requests before retrying.'
              : 'Could not update this friendship. Refresh and try again.',
        );
      }
      throw error;
    } finally {
      this.running = false;
    }
  }
}
