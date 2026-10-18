import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

// On Android the system Back key must close the topmost screen and leave the app only from a tab
// root. A screen gets that from a layout that calls useAndroidBack(onBack), so a pushed screen is
// covered only if every layout it renders is handed an onBack. Issue #3018: Sleep, Heart rate and
// the Goals editor left the app because their layout never registered a Back handler.

const root = resolve(import.meta.dirname, '..', 'src');
const LAYOUTS = ['PageLayout', 'Screen', 'WorkoutLayout', 'HealthDetailLayout'];
// Tab roots: Back from these leaves the app on purpose.
const TAB_ROOTS = new Set([
  'HomeScreen',
  'HealthScreen',
  'WorkoutScreen',
  'NutritionScreen',
  'MoreScreen',
]);
// Rendered inside App's own <Screen onBack>, so App registers Back for them.
const HOSTED_BY_APP = new Set(['DataScreen', 'SettingsScreen']);

function parse(source: string, name: string) {
  return ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function jsxElements(file: ts.SourceFile, names: string[]) {
  const found: { name: string; attrs: string[]; line: number }[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const name = node.tagName.getText();
      if (names.includes(name)) {
        found.push({
          name,
          attrs: node.attributes.properties.map((p) =>
            ts.isJsxAttribute(p) ? p.name.getText() : p.getText(),
          ),
          line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

async function registeredScreens() {
  const appPath = resolve(root, 'app', 'App.tsx');
  const app = parse(await readFile(appPath, 'utf8'), appPath);
  const jsx = new Set(
    jsxElements(app, [
      ...[...(await readFile(appPath, 'utf8')).matchAll(/<([A-Z]\w*(?:Screen|Builder))\b/g)].map(
        (m) => m[1]!,
      ),
    ]).map((e) => e.name),
  );
  const screens: { name: string; path: string }[] = [];
  for (const statement of app.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings) continue;
    const bindings = statement.importClause.namedBindings;
    if (!ts.isNamedImports(bindings)) continue;
    const spec = (statement.moduleSpecifier as ts.StringLiteral).text;
    for (const el of bindings.elements) {
      const name = el.name.text;
      if (jsx.has(name)) {
        screens.push({ name, path: resolve(dirname(appPath), `${spec}.tsx`) });
      }
    }
  }
  return screens;
}

test('layouts that take onBack register the Android Back handler', async () => {
  for (const file of ['Screen', 'PageLayout', 'HealthDetailLayout']) {
    const source = await readFile(resolve(root, 'shared', 'ui', `${file}.tsx`), 'utf8');
    assert.match(source, /useAndroidBack\(onBack\)/, `${file} must call useAndroidBack(onBack)`);
  }
  const workout = await readFile(
    resolve(root, 'features', 'workouts', 'components', 'WorkoutLayout.tsx'),
    'utf8',
  );
  assert.match(workout, /<PageLayout[^>]*onBack=\{onBack\}/s, 'WorkoutLayout must pass onBack on');
});

test('the screen registry is found', async () => {
  const screens = await registeredScreens();
  assert.ok(screens.length >= 30, `only found ${screens.length} screens in App.tsx`);
});

test('every pushed screen hands onBack to every layout it renders', async () => {
  const problems: string[] = [];
  for (const screen of await registeredScreens()) {
    if (TAB_ROOTS.has(screen.name) || HOSTED_BY_APP.has(screen.name)) continue;
    const source = await readFile(screen.path, 'utf8');
    const layouts = jsxElements(parse(source, screen.path), LAYOUTS);
    if (layouts.length === 0) {
      problems.push(`${screen.name} renders no layout, so nothing registers Back`);
    }
    for (const layout of layouts) {
      if (!layout.attrs.includes('onBack')) {
        problems.push(`${screen.name}:${layout.line} <${layout.name}> has no onBack`);
      }
    }
  }
  assert.deepEqual(problems, [], `Back would leave the app from:\n${problems.join('\n')}`);
});
