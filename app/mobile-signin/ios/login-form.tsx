'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function IosLoginForm({ callbackUrl, state }: { callbackUrl: string; state: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function signInWithGoogle() {
    setBusy(true)
    setError(null)
    try {
      await signIn('google', { callbackUrl })
    } catch {
      setError('Could not open Google sign-in. Try again.')
      setBusy(false)
    }
  }
  async function signInWithEmail(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await signIn('credentials', { email, password, callbackUrl, mobileState: state, redirect: false })
      if (result?.error === 'account_pending') {
        window.location.assign('/mobile-signin/ios?error=account_pending')
      } else if (result?.error) {
        setError(result.error === 'CredentialsSignin' ? 'Invalid email or password.' : 'Could not sign in. Try again.')
      } else if (result?.url) {
        const target = new URL(result.url, window.location.origin)
        if (target.origin !== window.location.origin || !['/auth-mobile-bridge', '/mobile-signin/ios'].includes(target.pathname)) {
          throw new Error('Unexpected login continuation.')
        }
        window.location.assign(target.toString())
      } else {
        setError('Could not sign in. Try again.')
      }
    } catch {
      setError('Could not sign in. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={signInWithGoogle}>
        Sign in with Google
      </Button>
      <form onSubmit={signInWithEmail} className="space-y-3">
        <Input
          type="email"
          aria-label="Sign-in email"
          placeholder="Email"
          autoComplete="email"
          required
          value={email}
          disabled={busy}
          onChange={event => setEmail(event.target.value)}
        />
        <Input
          type="password"
          aria-label="Sign-in password"
          placeholder="Password"
          autoComplete="current-password"
          required
          value={password}
          disabled={busy}
          onChange={event => setPassword(event.target.value)}
        />
        <Button type="submit" variant="outline" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in with email'}
        </Button>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
