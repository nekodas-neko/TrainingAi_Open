'use client'

import { isMobileAuthCompleteUrl, mobileBackendOrigin, mobileSignInBeginUrl } from './return-scheme'

const MOBILE_AUTH_VERIFIER_KEY = 'ta-mobile-auth-verifier'

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// The installed app's id tells the real app from TrainingAi Dev. If it cannot be read, the real
// app's behaviour is the one that results.
async function appId(): Promise<string | null> {
  try {
    const { App } = await import('@capacitor/app')
    return (await App.getInfo()).id
  } catch {
    return null
  }
}

export async function beginAndroidSignIn() {
  const id = await appId()
  const origin = mobileBackendOrigin(window.location.origin, id)
  if (!origin) {
    return
  }
  const { Browser } = await import('@capacitor/browser')
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = base64url(new Uint8Array(digest))
  localStorage.setItem(MOBILE_AUTH_VERIFIER_KEY, verifier)
  await Browser.open({ url: mobileSignInBeginUrl(origin, id, challenge) })
}

export async function completeAndroidSignIn(url: string) {
  if (!isMobileAuthCompleteUrl(url, await appId())) {
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
