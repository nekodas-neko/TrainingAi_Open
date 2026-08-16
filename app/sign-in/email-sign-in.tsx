'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { clearAllCache, enableCacheWrites } from '@/lib/sqlite/cache'

export default function EmailSignIn() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  // Sign-out disables cache writes so in-flight requests cannot re-seed the outgoing account's data
  // after the clear (lib/sqlite/cache.ts). Reaching this screen is the one point where a new session
  // provably begins, so it is where the latch comes off — but a request that started before sign-out
  // can still land in the gap between the clear and this mount, so the cache is swept once more
  // first. Measured: without the sweep, two keys reappeared after an otherwise clean sign-out.
  useEffect(() => {
    void clearAllCache().catch(() => {}).finally(() => { enableCacheWrites() })
  }, [])

  useEffect(() => {
    if (searchParams.get('registered') === '1') {
      toast.success('Account created', { description: 'Sign in below — or wait for approval if not yet invited.' })
    }
    if (searchParams.get('error') === 'CredentialsSignin') {
      toast.error('Invalid email or password')
    }
  }, [searchParams])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    // Let Auth.js handle all redirects:
    // - success        → callbackUrl (/)
    // - inactive user  → /pending   (from signIn callback)
    // - wrong password → /sign-in?error=CredentialsSignin (handled by useEffect below)
    await signIn('credentials', { email, password, callbackUrl: '/' })
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-left">
      {/* The placeholder is a hint, never the label: it disappears on focus, so the field loses
          its identity exactly while it is being typed into (WCAG 3.3.2), and a screen reader
          announces an unnamed box. This is the first screen a new account sees. */}
      <Input
        type="email"
        aria-label="Email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="Email"
        required
        autoComplete="email"
        className="bg-muted"
      />
      <Input
        type="password"
        aria-label="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder="Password"
        required
        autoComplete="current-password"
        className="bg-muted"
      />
      <Button type="submit" disabled={loading} variant="outline" className="w-full">
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign in with email
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        No account?{' '}
        <Link href="/register" className="underline underline-offset-4">Create one</Link>
      </p>
    </form>
  )
}
