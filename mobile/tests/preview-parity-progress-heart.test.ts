import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('Progress cards keep their natural height: the status slot only takes room while active (#2901, #2933)', () => {
  const header = read('features/health/components/HealthResourceHeader.tsx');
  assert.match(header, /status = 'when-active'/);
  assert.match(read('features/workouts/components/ResourceStatus.tsx'), /whenActive && !statusVisible\(state\)/);
});

test('every inline status on a card header is drawn only while active (#3521)', () => {
  const files = [
    'features/progress/StrengthScreen.tsx',
    'features/health/components/BodyHeartCards.tsx',
    'features/health/components/BodyActivityCards.tsx',
    'features/health/components/MuscleStatusCard.tsx',
    'features/health/components/TrainingCalendarCard.tsx',
    'features/health/components/TrainingPanel.tsx',
    'features/health/components/RecordedHealthCards.tsx',
    'features/health/components/HealthResourceHeader.tsx',
  ];
  for (const file of files) {
    const source = read(file);
    const total = source.match(/<ResourceStatus\s+inline(?!=)\b/g)?.length ?? 0;
    const active = source.match(/<ResourceStatus\s+inline\s+whenActive\b/g)?.length ?? 0;
    assert.ok(total > 0 && active === total, `${file}: ${active} of ${total} inline statuses use whenActive`);
  }
});

test('Health keeps the current app\'s bordered header (#3521)', () => {
  assert.doesNotMatch(read('features/health/screens/HealthScreen.tsx'), /^\s*landing\s*$/m);
});

test('the Progress exercise rows and the Strength Trend value use the web sizes (#2901)', () => {
  const panel = read('features/health/components/ProgressPanel.tsx');
  assert.match(panel, /variant="strengthRowValue"/);
  assert.match(panel, /variant="strengthRowDelta"/);
  assert.match(read('features/progress/StrengthScreen.tsx'), /variant="trendValue"/);
});

test('the page gradient keeps its last colour underneath, so a tall page never shows the teal app background (#2933)', () => {
  assert.match(read('shared/ui/PageGradient.tsx'), /backgroundColor: base/);
});

test('a Today so far tile\'s unit is regular weight (#2933)', () => {
  assert.match(read('features/health/components/HeartDetails.tsx'), /tone="muted" style=\{\{ fontWeight: '400' \}\}>\s*\{' '\}/);
});
