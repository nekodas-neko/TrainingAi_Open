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
import { AWAITING_APPROVAL_SENTENCE } from '@/lib/approval-copy'

export default function EmailSignIn() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    void clearAllCache().catch(() => {}).finally(() => { enableCacheWrites() })
  }, [])

  useEffect(() => {
    if (searchParams.get('registered') === '1') {
      toast.success('Account created', { description: AWAITING_APPROVAL_SENTENCE })
    }
    if (searchParams.get('error') === 'CredentialsSignin') {
      toast.error('Invalid email or password')
    }
  }, [searchParams])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await signIn('credentials', { email, password, callbackUrl: '/' })
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-left">

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
