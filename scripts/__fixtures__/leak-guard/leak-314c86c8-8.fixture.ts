import { it, expect } from 'vitest'
import { Client } from 'pg'

it('makes a library row and holds it', async () => {
  
  const c = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'resets-its-own-tags', options: '-c vitest.run_tag=somebody-else' })
  await c.connect()
  try {
    const { rows } = await c.query("INSERT INTO exercise_library (name, equipment, muscles) VALUES ('Guard Probe 314c86c8 7', ARRAY['barbell'], '[]'::jsonb) RETURNING id")
    await new Promise(r => setTimeout(r, 300))
    
    expect(rows).toHaveLength(1)
  } finally {
    await c.end()
  }
})
