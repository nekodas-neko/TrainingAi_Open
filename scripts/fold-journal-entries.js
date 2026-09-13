#!/usr/bin/env node
//
// Fold loose journal entries into a batched history file — **and rewrite every citation that
// pointed at them**, which is the part that makes this different from the manual sweep.
//
// The manual sweep could only fold entries nothing linked to, because folding a cited one broke the
// citation. With 305 of 342 entries cited, that left only the newest foldable, so obeying the total
// ceiling meant deleting the recent window to preserve the archive (LA-80). Rewriting the link
// instead means "linked" stops meaning "unfoldable" and the window sheds oldest-first.
//
// **The five traps below are not hypothetical** — each was found by a separate `check-doc-links` run
// during earlier hand sweeps, and each is documented in `docs/overview/entries/README.md` §1-5. They
// are handled here so nobody has to rediscover them:
//
//   1. A durable doc cites the entry            → repoint at `history-<date>.md#<anchor>`
//   2. Links INSIDE a folded entry are relative to `docs/overview/entries/`, and the history file is
//      one level up — so `](../x)` and `](../../x)` BOTH lose a level. Re-resolve, don't string-edit.
//   3. A folded entry links to another entry     → folded target: same-file `#<anchor>`;
//                                                  still-loose target: needs an `entries/` prefix.
//   4. A STILL-LOOSE entry links to a folded one → `](../history-<date>.md#<anchor>)`. This link is
//      in a file the fold never touched, which is why it is the easy one to miss.
//   5. A concurrent PR can cite an entry mid-fold. Re-run this after merging `main`.
//
// Anchors are `<a id="<entry-basename>">` rather than heading slugs: the basename is what every
// existing citation already says, so a rewritten link stays recognisable and does not depend on
// anyone's heading-slug rules. `check-doc-links` resolves the file and ignores the fragment, so a
// wrong anchor would be invisible to CI — determinism here is doing real work.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENTRIES = path.join(ROOT, 'docs/overview/entries');
const OVERVIEW = path.join(ROOT, 'docs/overview');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : 40;

/** Every .md in the repo except the entries dir — the docs that might cite an entry. */
function allMarkdown(dir, skip, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.next', '.git'].includes(e.name)) continue;
      out.push(...allMarkdown(full, skip, []));
    } else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const loose = fs.readdirSync(ENTRIES).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();

// **Never fold an entry an agent baton cites.** Rewriting the link would work, but it would mean
// this sweep writing into another lane's live state file — which `entries/README.md` calls out as
// something a sweep should not do, and which races whatever that lane is doing right now. Batons are
// transient and rewritten wholesale at handover, so excluding their targets costs a handful of
// entries and removes the cross-lane write completely.
const BATONS = path.join(ROOT, 'docs/agents/state');
const batonBlob = fs.existsSync(BATONS)
  ? fs.readdirSync(BATONS).filter((f) => f.endsWith('.md'))
      .map((f) => fs.readFileSync(path.join(BATONS, f), 'utf8')).join('\n')
  : '';
const pinnedByBaton = loose.filter((f) => batonBlob.includes(f.replace(/\.md$/, '')));
const batch = loose.filter((f) => !pinnedByBaton.includes(f)).slice(0, LIMIT);
if (pinnedByBaton.length) console.log(`fold: ${pinnedByBaton.length} entry(ies) held back — cited by an agent baton`);
if (!batch.length) { console.log('fold: nothing to do'); process.exit(0); }

const foldDate = new Date().toISOString().slice(0, 10);
// The repo's history-file rule starts a NEW file as one nears ~250 KB, so a fold big enough to be
// worth doing has to roll rather than produce one 600 KB slab. Each entry is assigned its file up
// front, because a citation has to be rewritten to the file its target actually lands in.
const ROLL_BYTES = 250 * 1024;
const fileFor = new Map();
{
  let part = 1, used = 0;
  for (const f of batch) {
    const size = fs.statSync(path.join(ENTRIES, f)).size;
    if (used && used + size > ROLL_BYTES) { part++; used = 0; }
    used += size;
    fileFor.set(f.replace(/\.md$/, ''), `history-${foldDate}-folded-${part}.md`);
  }
}
const foldedSet = new Set(batch.map((f) => f.replace(/\.md$/, '')));
const histAbs = (base) => path.join(OVERVIEW, fileFor.get(base));
const anchorOf = (base) => base;

/**
 * Rewrite one markdown link target.
 * @param {string} target  the raw `](target)` value
 * @param {string} fromAbs absolute path of the file the link now lives in
 * @param {boolean} inHistory true when the link is being moved INTO the history file
 */
function rewrite(target, fromAbs, inHistory) {
  if (/^(https?:|mailto:|#)/.test(target)) return target;
  const [p, frag] = target.split('#');
  if (!p) return target;
  // Where does this link resolve from? A link being folded still resolves from entries/.
  const baseDir = inHistory ? ENTRIES : path.dirname(fromAbs);
  const abs = path.resolve(baseDir, p);
  const base = path.basename(abs).replace(/\.md$/, '');
  const isEntry = path.dirname(abs) === ENTRIES;

  if (isEntry && foldedSet.has(base)) {
    // Trap 1/3/4 — the target moved into the history file.
    // Same file only when BOTH ends landed in the same part — a roll makes it a real path again.
    if (inHistory && fileFor.get(base) === currentPart) return `#${anchorOf(base)}`;
    // No './' prefix — the repo's existing citations are bare ('docs/overview/entries/x.md'),
    // and a rewrite that changes style as well as target makes the diff harder to read than it is.
    const from = inHistory ? path.join(OVERVIEW, currentPart) : fromAbs;
    const rel = path.relative(path.dirname(from), histAbs(base)).replace(/\\/g, '/');
    return `${rel}#${anchorOf(base)}`;
  }
  if (inHistory) {
    // Trap 2/3 — the link did not move, but the FILE holding it did, one level up.
    const rel = path.relative(OVERVIEW, abs).replace(/\\/g, '/');
    return frag ? `${rel}#${frag}` : rel;
  }
  return target;
}

let currentPart = null;   // which history part the entry being folded is going into
const LINK_RE = /\]\(([^)\s]+)\)/g;

// **Trap 6, found 2026-09-10 and not in the README's list of five.** A citation's link TEXT is
// often the entry's path in backticks — `[`docs/overview/entries/x.md`](../../…)`. Rewriting only
// the target leaves that text naming a file that no longer exists, which `check-doc-links` cannot
// see (it reads targets) but `check-index-doc-paths` fails on, because it scans orientation docs for
// repo paths. Eighteen of these survived the first full run. The text becomes the bare entry name:
// still the informative half, and no longer a path that has to resolve.
const TEXT_PATH_RE = /\[`docs\/overview\/entries\/([^`\/]+)\.md`\]/g;

const rewriteAll = (text, fromAbs, inHistory) =>
  text
    .replace(LINK_RE, (m, t) => `](${rewrite(t, fromAbs, inHistory)})`)
    .replace(TEXT_PATH_RE, (m, base) => (foldedSet.has(base) ? `[\`${base}\`]` : m));

// ---- 1. Build the history file from the batch -------------------------------------------------
const parts = new Map();
for (const f of batch) {
  const abs = path.join(ENTRIES, f);
  const base = f.replace(/\.md$/, '');
  currentPart = fileFor.get(base);
  if (!parts.has(currentPart)) {
    parts.set(currentPart, `# Session journal — batch folded ${foldDate}\n\n` +
      `Entries folded out of \`docs/overview/entries/\` by \`scripts/fold-journal-entries.js\`,\n` +
      `oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every\n` +
      `citation was repointed here, at the \`<a id="…">\` anchor named after the entry's old filename.\n`);
  }
  const body = rewriteAll(fs.readFileSync(abs, 'utf8').trim(), abs, true);
  parts.set(currentPart, parts.get(currentPart) + `\n<a id="${anchorOf(base)}"></a>\n\n${body}\n`);
}
currentPart = null;

// ---- 2. Repoint every citation elsewhere in the repo ------------------------------------------
const others = allMarkdown(ROOT, ENTRIES).filter((f) => !f.startsWith(ENTRIES + path.sep));
const looseLeft = loose.filter((f) => !foldedSet.has(f.replace(/\.md$/, ''))).map((f) => path.join(ENTRIES, f));
const touched = [];
for (const f of [...others, ...looseLeft]) {
  const before = fs.readFileSync(f, 'utf8');
  const after = rewriteAll(before, f, false);
  if (after !== before) {
    touched.push([f, (before.match(LINK_RE) || []).length]);
    if (!DRY) fs.writeFileSync(f, after);
  }
}

if (DRY) {
  console.log(`fold --dry-run: would fold ${batch.length} entries into ${parts.size} history file(s)`);
  console.log(`  citations rewritten in ${touched.length} files:`);
  touched.slice(0, 15).forEach(([f]) => console.log('    ' + path.relative(ROOT, f)));
  if (touched.length > 15) console.log(`    … and ${touched.length - 15} more`);
  process.exit(0);
}

for (const [name, text] of parts) fs.writeFileSync(path.join(OVERVIEW, name), text);
for (const f of batch) fs.unlinkSync(path.join(ENTRIES, f));
console.log(`fold: ${batch.length} entries → ${[...parts.keys()].join(', ')}`);
console.log(`fold: citations rewritten in ${touched.length} files`);
console.log('fold: now run `node scripts/check-doc-links.js` and fix what it names — do not reason about which links moved.');
