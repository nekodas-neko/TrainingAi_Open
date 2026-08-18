#!/usr/bin/env node
/**
 * A Known Issue must live in exactly ONE of two places: the live list in `projectOverview.md`, or
 * the archive in `docs/overview/known-issues-resolved.md`. CLAUDE.md's rule is explicit — "Cut the
 * entry whole, append it to the archive, leave nothing behind."
 *
 * Q-139 was in both for ten days (found 2026-08-18, Q-553): archived as `✅ fixed 2026-08-08` while a
 * 69-line `🔴 … OPEN` row describing the bug as unfixed stayed in the file every session reads first.
 * Nothing detected it because nothing compared the two lists.
 *
 * Headings only, deliberately. Both files legitimately *mention* other issues' Q numbers in prose —
 * cross-references, retraction notes, "traced separately" asides. Matching any occurrence reports
 * those as duplicates: on the run that found Q-139 it also flagged Q-107, whose only appearance in
 * the archive is a note retracting a link to it. A heading is the entry; a mention is not.
 *
 * Two further narrowings, both learned by running it — the first version reported 4 and only 2 were
 * real:
 *
 *  - **A heading's identity is its FIRST Q number.** An archive heading may name a second issue in
 *    passing ("… (Q-75, …) — Q-76 fixed 2026-08-05 in v1.261.0"). That entry is about Q-75; reading
 *    Q-76 out of it makes the live Q-76 row look duplicated when it is not.
 *  - **Range headings are skipped.** A batch row spanning `Q-63…Q-69` legitimately overlaps an
 *    archived entry for one member that has since been fixed. That is a stale *range*, not a
 *    duplicated entry, and it wants a human deciding how to split the batch — not a red build.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const LIVE = path.join(ROOT, 'projectOverview.md')
const ARCHIVE = path.join(ROOT, 'docs/overview/known-issues-resolved.md')

// `Q-63…Q-69`, `Q-63...Q-69`, `Q-63-Q-69`, `Q-63 to Q-69`
const RANGE = /\bQ-\d{2,4}\s*(?:…|\.\.\.|--?|–|—|to)\s*Q?-?\d{2,4}\b/

const headingQs = (file, depth) => {
  const re = new RegExp(`^#{${depth}} .*`)
  const out = new Map()
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!re.test(line)) continue
    if (RANGE.test(line)) continue
    const first = line.match(/\bQ-(\d{2,4})\b/)
    if (first) out.set(`Q-${first[1]}`, line.trim())
  }
  return out
}

const live = headingQs(LIVE, 3)
const archived = headingQs(ARCHIVE, 3)

const both = [...live.keys()].filter((q) => archived.has(q))

if (both.length > 0) {
  console.error('Known Issue(s) present in BOTH the live list and the resolved archive:\n')
  for (const q of both) {
    console.error(`  • ${q}`)
    console.error(`      live:     ${live.get(q)}`)
    console.error(`      archived: ${archived.get(q)}`)
  }
  console.error(
    '\nAn issue belongs to exactly one list. If it is genuinely resolved, cut the live row whole' +
      '\n(CLAUDE.md: "leave nothing behind"). If something is still owed — open work, a pending owner' +
      '\nor device check — it belongs in the live list only, and the archive entry is premature.',
  )
  process.exit(1)
}

console.log(
  `check-known-issue-duplication: OK — ${live.size} live, ${archived.size} archived, no overlap.`,
)
