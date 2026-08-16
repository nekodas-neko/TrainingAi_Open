import { describe, it, expect } from 'vitest'
import { chatSchema } from '../chat'

const base = { prompt: 'hi', conversationHistory: [] }

describe('chatSchema.localDate', () => {
  it('accepts the slash format the client actually sends (localDateString → YYYY/MM/DD)', () => {
    expect(chatSchema.safeParse({ ...base, localDate: '2026/07/19' }).success).toBe(true)
  })

  it('accepts the dash format too', () => {
    expect(chatSchema.safeParse({ ...base, localDate: '2026-07-19' }).success).toBe(true)
  })

  it('is optional', () => {
    expect(chatSchema.safeParse(base).success).toBe(true)
  })

  it('still rejects a genuinely malformed date', () => {
    expect(chatSchema.safeParse({ ...base, localDate: 'yesterday' }).success).toBe(false)
  })
})
