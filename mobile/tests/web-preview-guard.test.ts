/**
 * #3761. The browser preview's development sign-in (`integrations/auth/web-preview.ts`), its
 * navigation controls (`integrations/web-preview/preview-controls.ts`) and the localhost
 * allowance they switch on must not reach a release build. Three layers keep them out, and this
 * file checks each one; CI's `Mobile client` job also runs `scripts/check-release-bundles.mjs` on
 * the real production export of every platform.
 *   1. Android and iOS never resolve a `.web.ts` file, the only place either module is required.
 *   2. On the web, the require sits behind `__DEV__`, which Metro folds to false in a production
 *      export, so the module is dropped (proved by the bundle check, not here).
 *   3. The allowance is off until `web-preview.ts` turns it on, and nothing else does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendOrigin } from '../src/features/account/api/client.ts';
import { allowLocalHttpBackend } from '../src/core/network/local-backend.ts';
import { DEV_ONLY_MARKERS, markerHits } from '../scripts/check-release-bundles.mjs';

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(mobile, 'src');
const WEB_PREVIEW = path.join(src, 'integrations/auth/web-preview.ts');
const PREVIEW_CONTROLS = path.join(src, 'integrations/web-preview/preview-controls.ts');
const DEV_ONLY = [WEB_PREVIEW, PREVIEW_CONTROLS];

type Platform = 'android' | 'ios' | 'web';
const SOURCE = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
function candidates(platform: Platform) {
  const prefixes = platform === 'web' ? ['.web', ''] : [`.${platform}`, '.native', ''];
  return prefixes.flatMap((prefix) => SOURCE.map((ext) => `${prefix}${ext}`));
}
/** Metro's order for a relative import: exact file, then platform suffixes, then index files. */
function resolve(from: string, spec: string, platform: Platform): string | null {
  const base = path.resolve(path.dirname(from), spec);
  if (path.extname(base) && fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of candidates(platform)) if (fs.existsSync(base + ext)) return base + ext;
  for (const ext of candidates(platform)) {
    const index = path.join(base, `index${ext}`);
    if (fs.existsSync(index)) return index;
  }
  return null;
}
const IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm;
/** Every app module an entry reaches through relative imports, as Metro would for `platform`. */
function reachable(entry: string, platform: Platform) {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || file.includes(`${path.sep}node_modules${path.sep}`)) continue;
    seen.add(file);
    if (!SOURCE.includes(path.extname(file))) continue;
    // Type-only imports are erased before bundling.
    const text = fs
      .readFileSync(file, 'utf8')
      .replace(/^\s*(?:import|export)\s+type\s[^;]*;/gm, '')
      .replace(/typeof import\(\s*['"][^'"]+['"]\s*\)/g, '');
    for (const match of text.matchAll(IMPORT)) {
      const next = resolve(file, match[1], platform);
      if (next) queue.push(next);
    }
  }
  return seen;
}
const entry = path.join(mobile, 'index.ts');

for (const platform of ['android', 'ios'] as const) {
  test(`a ${platform} bundle never reaches the development preview modules`, () => {
    const graph = reachable(entry, platform);
    // The walk really covers the app: it reaches the native auth adapter and the no-op controls.
    assert.ok(graph.has(path.join(src, 'integrations/auth/platform.native.ts')));
    assert.ok(graph.has(path.join(src, 'integrations/web-preview/controls.ts')));
    assert.ok(graph.size > 300, `only ${graph.size} modules reached`);
    for (const file of DEV_ONLY) assert.equal(graph.has(file), false, path.relative(mobile, file));
  });
}

test('only the web build can reach them, through its development branch', () => {
  const graph = reachable(entry, 'web');
  for (const file of DEV_ONLY) assert.ok(graph.has(file), path.relative(mobile, file));
  for (const file of ['integrations/auth/platform.web.ts', 'integrations/web-preview/controls.web.ts']) {
    const text = fs.readFileSync(path.join(src, file), 'utf8');
    assert.match(text, /__DEV__ && process\.env\.EXPO_PUBLIC_WEB_PREVIEW_AUTH === '1'\s*\?/, file);
  }
});

test('nothing but the development adapter switches the localhost allowance on', () => {
  const callers: string[] = [];
  const walk = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      // #2560: every source-tree walker skips the check fixtures, as it does node_modules.
      if (item.isDirectory()) {
        if (!['node_modules', '__check_fixture__'].includes(item.name)) walk(full);
      }
      else if (/(?<!function )allowLocalHttpBackend\(\)/.test(fs.readFileSync(full, 'utf8'))) callers.push(full);
    }
  };
  walk(src);
  assert.deepEqual(callers, [WEB_PREVIEW]);
});

test('the https rule holds until then, and the allowance covers only a local server', () => {
  assert.throws(() => backendOrigin('http://localhost:3000'));
  assert.throws(() => backendOrigin('http://127.0.0.1:8099'));
  assert.equal(backendOrigin('https://example.com'), 'https://example.com');
  allowLocalHttpBackend();
  assert.equal(backendOrigin('http://localhost:8099'), 'http://localhost:8099');
  assert.equal(backendOrigin('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
  assert.throws(() => backendOrigin('http://example.com'));
  assert.throws(() => backendOrigin('http://192.168.1.20:3000'));
  assert.throws(() => backendOrigin('http://localhost:3000/path'));
});

test('no release configuration turns the preview sign-in on', () => {
  const files = [
    path.join(mobile, 'eas.json'),
    path.join(mobile, 'app.json'),
    path.join(mobile, 'app.config.js'),
    path.join(mobile, '.env.example'),
    ...['native-release.yml', 'native-side-by-side.yml', 'android.yml', 'mobile.yml'].map((name) =>
      path.join(mobile, '..', '.github', 'workflows', name),
    ),
  ];
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /WEB_PREVIEW_AUTH/, path.basename(file));
  }
});

test('the bundle check looks for strings the development modules really contain', () => {
  const sources = DEV_ONLY.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  for (const marker of DEV_ONLY_MARKERS) assert.ok(sources.includes(`'${marker}'`), marker);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-check-'));
  const clean = path.join(dir, 'clean.js');
  const dirty = path.join(dir, 'dirty.hbc');
  fs.writeFileSync(clean, 'console.log("release")');
  fs.writeFileSync(dirty, `\u0000${DEV_ONLY_MARKERS[0]}\u0000`);
  assert.deepEqual(markerHits([clean, dirty]), [[dirty, DEV_ONLY_MARKERS[0]]]);
});
