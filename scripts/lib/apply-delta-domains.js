'use strict';
//
// Extracting `applyDeltaBody`'s domain list, in ONE place, so the check and its test agree.
//
// The scoping is the whole subtlety. `delta.*` appears elsewhere in the file — `applyDelta` itself
// touches it before delegating — so a scan of the file finds domains the batching cost does not
// depend on. The walk below starts at the method declaration and follows brace depth to the
// method's own closing brace, rather than stopping at whatever `}` comes next.

/**
 * @param {string} source full text of sqlite-backend.ts
 * @returns {{ ok: true, domains: string[] } | { ok: false, reason: 'missing' | 'unterminated' }}
 */
function extractDomains(source) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => /\bapplyDeltaBody\s*\(/.test(l) && /private|async/.test(l));
  if (start < 0) return { ok: false, reason: 'missing' };

  let depth = 0;
  let end = -1;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && i > start) { end = i; break; }
  }
  if (end < 0) return { ok: false, reason: 'unterminated' };

  const body = lines.slice(start, end + 1).join('\n');
  const domains = [...new Set([...body.matchAll(/\bdelta\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
  return { ok: true, domains: domains.sort() };
}

module.exports = { extractDomains };
