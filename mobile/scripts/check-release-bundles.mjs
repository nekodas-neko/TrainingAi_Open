#!/usr/bin/env node
/**
 * #3761. Fails if a release bundle carries the browser preview's development sign-in or its
 * navigation controls. CI's `Mobile client` job runs it on the production export it already makes
 * (`expo export --platform all --output-dir dist`): those are the bundles a release APK embeds and
 * a production web build serves.
 *
 *   node scripts/check-release-bundles.mjs dist
 *
 * The markers are strings only `src/integrations/auth/web-preview.ts` and
 * `src/integrations/web-preview/preview-controls.ts` contain, and that survive minification.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEV_ONLY_MARKERS = [
  'trainingai-web-preview-auth', // web-preview.ts: WEB_PREVIEW_AUTH_MESSAGE
  'Browser preview', // web-preview.ts: the device label it signs in with
  '__trainingaiPreview', // preview-controls.ts: PREVIEW_CONTROLS_GLOBAL
];
const BUNDLE = /\.(js|hbc|bundle)$/;

/** Every bundle file under `dir`. */
export function bundleFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...bundleFiles(full));
    else if (BUNDLE.test(entry.name)) found.push(full);
  }
  return found;
}
/** `[file, marker]` for each marker a bundle contains. */
export function markerHits(files, markers = DEV_ONLY_MARKERS) {
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file).toString('latin1');
    for (const marker of markers) if (text.includes(marker)) hits.push([file, marker]);
  }
  return hits;
}

function main() {
  const dir = path.resolve(process.argv[2] ?? 'dist');
  if (!fs.existsSync(dir)) {
    console.error(`No export at ${dir}.`);
    process.exit(1);
  }
  const files = bundleFiles(dir);
  const platforms = ['android', 'ios', 'web'].filter((platform) =>
    files.some((file) => file.split(path.sep).includes(platform)),
  );
  if (!files.length) {
    console.error(`No bundles under ${dir}.`);
    process.exit(1);
  }
  const hits = markerHits(files);
  for (const [file, marker] of hits) {
    console.error(`${path.relative(dir, file)} contains "${marker}", which only the development browser preview may carry.`);
  }
  if (hits.length) process.exit(1);
  console.log(
    `Checked ${files.length} bundle files (${platforms.join(', ') || 'unknown platforms'}): no development preview code.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
