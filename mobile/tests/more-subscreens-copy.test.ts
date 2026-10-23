import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
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

test('the Friends feed uses the current app icons: a trophy for achievements, a trend for PRs', () => {
  const panel = readFileSync(
    new URL('../src/features/social/components/FriendsPanel.tsx', import.meta.url),
    'utf8',
  );
  assert.ok(panel.includes("event.type === 'pr' ? 'upper' : 'trophy'"));
});
