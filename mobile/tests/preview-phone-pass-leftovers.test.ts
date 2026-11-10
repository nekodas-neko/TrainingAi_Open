import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { withSectionLongPress } from '../src/shared/ui/sectionLongPress.ts';

// Screens import React Native, which this runner cannot load, so the wiring is read as text. The
// order behind #3705 is tested in home.test.ts.
const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test("a Pressable with no long press of its own takes its section's (#3704)", () => {
  const open = () => {};
  const section = { onLongPress: open, delayLongPress: 350 };
  const onPress = () => {};
  assert.deepEqual(withSectionLongPress({ onPress }, section), {
    onPress,
    onLongPress: open,
    delayLongPress: 350,
  });
  // Its own long press wins, with its own delay.
  const own = () => {};
  assert.deepEqual(withSectionLongPress({ onPress, onLongPress: own, delayLongPress: 600 }, section), {
    onPress,
    onLongPress: own,
    delayLongPress: 600,
  });
  // Outside a section, or while Home is being edited, nothing changes.
  const props = { onPress };
  assert.equal(withSectionLongPress(props, null), props);
});

test("Home's long press reaches the card's own Pressable, so it opens the widget menu on tappable cards (#3704)", async () => {
  const section = await source('features/home/components/HomeSection.tsx');
  assert.match(section, /<SectionLongPressContext\.Provider value=\{longPress\}>/);
  assert.match(section, /editing \? null : \{ onLongPress: openMenu, delayLongPress: MENU_DELAY_MS \}/);
  assert.match(section, /setMenu\(true\)/);
  // Every touch a Home card renders goes through the section-aware Pressable: the cards' own, and
  // the shared primitives they use.
  for (const path of [
    'features/home/components/HomeWidgets.tsx',
    'features/home/components/HomeRecommendation.tsx',
    'features/home/components/HomeTrainingSummary.tsx',
    'shared/ui/TouchSurface.tsx',
    'shared/ui/AppButton.tsx',
    'shared/ui/IconButton.tsx',
    'shared/ui/MetricCard.tsx',
  ]) {
    const text = await source(path);
    assert.match(text, /import \{ Pressable \} from '[./]+(shared\/ui\/)?Pressable';/, path);
    const native = text.match(/import \{([^}]*)\} from 'react-native';/)?.[1] ?? '';
    assert.doesNotMatch(native, /\bPressable\b/, path);
  }
  const wrapper = await source('shared/ui/Pressable.tsx');
  assert.match(wrapper, /withSectionLongPress\(props, section\)/);
});

test('closing Log Food clears its draft, so the next one starts clean as in the current app (#3707)', async () => {
  const text = await source('features/nutrition/components/FoodLogger.tsx');
  const abandon = text.slice(text.indexOf('function abandon()'), text.indexOf('const title ='));
  assert.match(abandon, /abandoned\.current = true/);
  assert.match(abandon, /clearDraft\(photoKey\)/);
  assert.match(abandon, /clearDraft\(loggerKey\)/);
  assert.match(abandon, /onClose\(\)/);
  assert.match(text, /title=\{captureStage \?\? title\}\s+onClose=\{abandon\}/);
  // An analysis that finishes after ✕ does not write the draft back.
  const analyse = text.slice(text.indexOf("'/api/nutrition/scan'"), text.indexOf('await resources.saveDraft(loggerKey, next)'));
  assert.match(analyse, /if \(abandoned\.current\) return;/);
});
