// Standalone migration runner for the local dev DB.
// Mirrors lib/data/postgres/client.ts's ensureSchema(), without needing ts-node.
const { Pool } = require('pg')
const { readFileSync, readdirSync } = require('fs')
const { join } = require('path')

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const migrationsDir = join(__dirname, '../../lib/data/postgres/migrations')
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  for (const file of files) {
    const sqlText = readFileSync(join(migrationsDir, file), 'utf-8')
    try {
      await pool.query(sqlText)
    } catch (err) {
      console.warn(`[migrate] ${file}:`, err.message?.slice(0, 200))
    }
  }
  await pool.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
