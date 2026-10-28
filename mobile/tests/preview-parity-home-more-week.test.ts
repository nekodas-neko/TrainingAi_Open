import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('Week in review draws the Recovery sparklines gently curved, with dots (#2935)', () => {
  const tile = read('features/health/components/WeekMetricTile.tsx');
  assert.match(tile, /dots="all"/);
  assert.match(tile, /tension=\{0\.3\}/);
});

test('the Training chart sets its weekday letters off the bars and in the web chart\'s muted 10 px', () => {
  const screen = read('features/health/screens/HealthWeekScreen.tsx');
  const chart = screen.slice(screen.indexOf('<BarChart'), screen.indexOf('/>', screen.indexOf('<BarChart')));
  assert.match(chart, /labelGap=/);
  assert.doesNotMatch(chart, /readable/);
  assert.match(chart, /labelGap=\{11\}/);
  assert.match(chart, /labelWeight="400"/);
});

test('Muscle volume\'s title is the small-capitals card title', () => {
  const screen = read('features/health/screens/HealthWeekScreen.tsx');
  assert.match(screen, /variant="cardTitle" tone="muted" accessibilityRole="header" style=\{\{ flex: 1 \}\}>\s*Muscle volume this week/);
});

test('Achievements uses the right-pointing chevron that turns down when open (#2902)', () => {
  assert.match(read('features/rewards/components/AchievementsSection.tsx'), /collapsed="right"/);
  const icon = read('shared/ui/DisclosureIcon.tsx');
  assert.match(icon, /\['0deg', '90deg'\]/);
  assert.match(icon, /'forward'/);
});

test('the device health row is single-line; Devices & connections keeps its caption (#3074)', () => {
  const more = read('features/settings/screens/MoreScreen.tsx');
  assert.doesNotMatch(more, /subtitle="Connection, permissions/);
  assert.match(more, /subtitle="Oura account, heart-rate strap"/);
});

test('the Home heart-rate line is neutral unless the card has a colour (#2903)', () => {
  const card = read('features/health/components/HrDayCard.tsx');
  assert.doesNotMatch(card, /lineColor \?\? theme\.tones\.heart/);
  assert.match(card, /color=\{hrColor\}/);
});

test('the Collection card\'s restless note wraps rather than cutting off (#2903)', () => {
  const card = read('features/collection/components/CollectionCard.tsx');
  assert.doesNotMatch(card, /adjustsFontSizeToFit/);
  assert.doesNotMatch(card, /minimumFontScale/);
});

test('the muscle volume rows keep the web\'s 48 px touch floor', () => {
  assert.match(read('features/health/components/MuscleVolumeFigure.tsx'), /minHeight: theme\.sizes\.touchTarget/);
});
