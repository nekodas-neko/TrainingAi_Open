#!/usr/bin/env node
// CI custom rule (Q-27 / docs/superpowers/plans/2026-07-30-domain-docs-deep-migration.md Task 4):
// every relative markdown link in a repo .md file must resolve to a real file. Nothing else
// protects the docs/domains/ indexes and the backlog's cross-links from rotting the moment a doc
// moves or is renamed — an ad hoc run of this same check immediately found 16 dead links in
// docs/implementation-backlog.md (all carrying one extra `../`) before this script existed.
//
// Scope: every .md file under docs/ plus the repo-root .md files (README.md, CLAUDE.md,
// projectOverview.md). Only [text](path) markdown links are checked, and only relative ones
// (no scheme, doesn't start with '/') — external URLs and absolute repo paths are out of scope,
// as is a bare '#anchor' fragment on its own (no target file to resolve).
const fs = require('fs')
const path = require('path')

const ROOT = process.cwd()
const ROOT_MD_FILES = ['README.md', 'CLAUDE.md', 'projectOverview.md']
const DOCS_DIR = 'docs'

function listMarkdownFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listMarkdownFiles(full))
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

const files = [
  ...ROOT_MD_FILES.filter(f => fs.existsSync(path.join(ROOT, f))),
  ...listMarkdownFiles(path.join(ROOT, DOCS_DIR)),
]

// [text](path) or [text](path "title") — captures the path only, not an embedded title.
const LINK_RE = /\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

// Strip fenced code blocks and inline code spans before scanning for links — a regex literal
// or a quoted markdown example inside backticks (both occur in this repo's review docs) can
// look exactly like [text](path) to LINK_RE, and neither is a real link to resolve.
function stripCode(src) {
  return src
    .replace(/```[\s\S]*?```/g, m => '\n'.repeat((m.match(/\n/g) ?? []).length))
    .replace(/`[^`\n]*`/g, '')
}

function isRelative(target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false // scheme:// (http, mailto, etc.)
  if (target.startsWith('/')) return false // absolute repo/site path — out of scope
  if (target.startsWith('#')) return false // same-file anchor — no separate target to resolve
  return true
}

const violations = []
for (const file of files) {
  const src = stripCode(fs.readFileSync(file, 'utf8'))
  const fileDir = path.dirname(file)
  let m
  while ((m = LINK_RE.exec(src)) !== null) {
    const raw = m[1]
    if (!isRelative(raw)) continue
    const [targetPath] = raw.split('#') // strip a trailing #anchor before resolving the file
    if (!targetPath) continue // pure '#anchor' with content before it, e.g. 'file.md#x' handled above
    const resolved = path.resolve(fileDir, targetPath)
    if (!fs.existsSync(resolved)) {
      const line = src.slice(0, m.index).split('\n').length
      violations.push(`${path.relative(ROOT, file)}:${line}: broken link -> ${raw}`)
    }
  }
}

if (violations.length) {
  console.error(`check-doc-links: ${violations.length} broken relative link(s):`)
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log(`check-doc-links: OK (${files.length} files checked)`)
