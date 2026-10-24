import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { feedIconName, leaderIconName } from '../src/features/social/data/feed-icons.ts';
import {
  HISTORY_WINDOW_DAYS,
  dataSyncCopy,
  importCaption,
} from '../src/features/settings/data/data-sync-copy.ts';

test('the history import reads 30 days at a time, as the current app says', () => {
  assert.equal(HISTORY_WINDOW_DAYS, 30);
  assert.equal(
    importCaption('Health Connect'),
    'Pull older Health Connect data, 30 days at a time',
  );
});

test('Data & Sync captions match the current app word for word', () => {
  const web = readFileSync(
    new URL('../../components/more/data-sync-panel.tsx', import.meta.url),
    'utf8',
  );
  for (const row of [dataSyncCopy.sync, dataSyncCopy.restore, dataSyncCopy.exportData]) {
    assert.ok(web.includes(row.title), row.title);
    assert.ok(web.includes(row.caption), row.caption);
  }
});

test('Friends icons: trend for a PR, trophy otherwise, medal for first place', () => {
  assert.equal(feedIconName('pr'), 'upper');
  assert.equal(feedIconName('achievement'), 'trophy');
  assert.equal(leaderIconName, 'medal');
});
