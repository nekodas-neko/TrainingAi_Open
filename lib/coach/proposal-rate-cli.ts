// #2245 — print the Coach proposal-rate report. Bundled and run by `scripts/coach-proposal-rate.mjs`;
// read-only. Against production, point DATABASE_URL at the `claude_ro` role and keep the default
// `--schema claude_ro`, whose views are row-scoped to the owner (every count is then the owner's).
// Locally, pass `--schema public`.
import { Client } from 'pg'
import { coachProposalRate, type StoredCoachMessage } from '@/lib/coach/proposal-rate'
import { normalizeDateParamIso } from '@trainingai/shared/date-utils'

async function main() {
  const args = process.argv.slice(2)
  const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  const schema = flag('--schema') ?? 'claude_ro'
  const since = normalizeDateParamIso(flag('--since') ?? '2000-01-01')
  if (!/^[a-z_]+$/.test(schema)) throw new Error(`bad --schema ${schema}`)
  if (since == null) throw new Error(`bad --since ${flag('--since')}`)

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query<{ thread_id: string; role: string; parts: unknown; position: number }>(
      `SELECT thread_id, role, parts, position FROM ${schema}.coach_messages WHERE created_at >= $1::date ORDER BY thread_id, position`,
      [since],
    )
    const threads = new Map<string, StoredCoachMessage[]>()
    for (const r of rows) threads.set(r.thread_id, [...(threads.get(r.thread_id) ?? []), { role: r.role, parts: r.parts, position: r.position }])
    console.info(JSON.stringify({ schema, since, threads: threads.size, ...coachProposalRate([...threads.values()]) }, null, 2))
  } finally {
    await client.end()
  }
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
