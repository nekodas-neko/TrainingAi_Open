#!/usr/bin/env node
/**
 * Applies `.github/labels.yml` to the repository's issue labels.
 *
 * Additive on purpose: creates and updates, never deletes. Deleting a label strips it from every
 * issue that carries it, so removing one from the file is a two-step job a human does deliberately.
 *
 * Usage: node scripts/sync-labels.js [--dry-run]
 *   GH_REPO defaults to the repo this is run against via `gh`.
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')

const dryRun = process.argv.includes('--dry-run')
const repo = process.env.GH_REPO || 'nekodas-neko/TrainingAi_Open'
const file = path.join(__dirname, '..', '.github', 'labels.yml')
const labels = yaml.load(fs.readFileSync(file, 'utf8'))

if (!Array.isArray(labels) || labels.length === 0) {
  console.error(`${file} did not parse to a non-empty list.`)
  process.exit(1)
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const existing = new Set()
for (let page = 1; ; page++) {
  const batch = JSON.parse(gh(['api', `repos/${repo}/labels?per_page=100&page=${page}`]))
  batch.forEach((l) => existing.add(l.name))
  if (batch.length < 100) break
}

let created = 0
let updated = 0
for (const label of labels) {
  const { name, color, description = '' } = label
  if (!name || !color) {
    console.error(`Every label needs a name and a color; got ${JSON.stringify(label)}`)
    process.exit(1)
  }
  const verb = existing.has(name) ? 'update' : 'create'
  if (dryRun) {
    console.log(`${verb} ${name}`)
    continue
  }
  if (verb === 'update') {
    gh(['api', '-X', 'PATCH', `repos/${repo}/labels/${encodeURIComponent(name)}`, '-f', `color=${color}`, '-f', `description=${description}`])
    updated++
  } else {
    gh(['api', '-X', 'POST', `repos/${repo}/labels`, '-f', `name=${name}`, '-f', `color=${color}`, '-f', `description=${description}`])
    created++
  }
  console.log(`${verb}d ${name}`)
}

console.log(`${labels.length} labels in the file — ${created} created, ${updated} updated${dryRun ? ' (dry run)' : ''}.`)
