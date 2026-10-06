export type AuthProvider = 'google' | 'apple'

export type AppleAuthAttempt = {
  id: string
  nonceHash: string
  userId: string | null
  createdAt: Date
  expiresAt: Date
}

export class IdentityConflict extends Error {
  constructor() {
    super('Sign in with your existing account, then connect Apple.')
    this.name = 'IdentityConflict'
  }
}
