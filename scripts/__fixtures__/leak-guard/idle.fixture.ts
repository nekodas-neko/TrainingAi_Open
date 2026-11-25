/** A passing test that touches no library row and lasts IDLE_MS. Run only by the leak guard's own test (#4109). */
import { it, expect } from 'vitest'

it('does nothing to the catalogue', async () => {
  await new Promise(r => setTimeout(r, Number(process.env.IDLE_MS ?? 3000)))
  expect(1).toBe(1)
})
