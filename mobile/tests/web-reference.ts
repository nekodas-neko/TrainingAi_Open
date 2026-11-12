import { readFileSync } from 'node:fs';

// #3729: the excerpts of the Capacitor app's source that the native tests compare against, frozen
// in `fixtures/web-reference.json` so these tests read nothing outside mobile/. The root suite's
// `scripts/__tests__/mobile-web-reference.test.ts` fails if an excerpt stops matching its file
// while that file still exists.
const reference = JSON.parse(readFileSync(new URL('./fixtures/web-reference.json', import.meta.url), 'utf8')) as {
  files: Record<string, string[]>;
};

/** The frozen excerpt of one Capacitor-app file (its repo path), excerpts joined by newlines. */
export function webReference(path: string): string {
  const excerpts = reference.files[path];
  if (!excerpts) throw new Error(`no excerpt of ${path} in tests/fixtures/web-reference.json`);
  return excerpts.join('\n');
}
