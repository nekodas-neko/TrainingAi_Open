'use client'

const MOBILE_BACKEND_ORIGIN = 'https://trainingai-production.up.railway.app'
const MOBILE_AUTH_VERIFIER_KEY = 'ta-mobile-auth-verifier'

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function beginAndroidSignIn() {
  const { Browser } = await import('@capacitor/browser')
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = base64url(new Uint8Array(digest))
  localStorage.setItem(MOBILE_AUTH_VERIFIER_KEY, verifier)
  await Browser.open({ url: `${MOBILE_BACKEND_ORIGIN}/mobile-signin/begin?challenge=${challenge}` })
}

export async function completeAndroidSignIn(url: string) {
  if (!url.startsWith('trainingai://auth-complete')) {
    return
  }
  try {
    const token = new URL(url).searchParams.get('token')
    if (!token) {
      return
    }
    const verifier = localStorage.getItem(MOBILE_AUTH_VERIFIER_KEY)
    const response = await fetch('/api/auth/exchange-mobile-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, verifier }),
    })
    if (response.ok) {
      localStorage.removeItem(MOBILE_AUTH_VERIFIER_KEY)
    }
    const { Browser } = await import('@capacitor/browser')
    await Browser.close().catch(() => {})
    if (response.ok && window.location.pathname === '/sign-in') {
      window.location.href = '/'
    }
  } catch {
    // Leave the login screen available for another attempt.
  }
}
