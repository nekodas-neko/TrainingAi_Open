'use client';
import { useState } from 'react';
import { signOutInPlace } from '@/app/actions';
import { signOutAndClearDevice } from '@/lib/sign-out';
import { Button } from '@/components/ui/button';
export function NativeConsentForm({ action }: { action: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function proceed() {
    setBusy(true);
    setError(null);
    try {
      const url = await action();
      if (!url) throw new Error('Sign-in expired');
      window.location.assign(url);
    } catch {
      setBusy(false);
      setError('Could not confirm sign-in. Close this window and start again from the app.');
    }
  }
  async function switchAccount() {
    setBusy(true);
    setError(null);
    // #3854: the same fenced sign-out as More, so no request in flight can sign this browser back in.
    try {
      await signOutAndClearDevice(signOutInPlace);
    } catch {
      setBusy(false);
      setError('Could not sign out. Close this window and start again from the app.');
      return;
    }
    window.location.reload();
  }
  return <div className="space-y-3">
    <Button className="w-full" disabled={busy} onClick={proceed}>{busy ? 'Continuing…' : 'Continue to app'}</Button>
    <Button className="w-full" variant="outline" disabled={busy} onClick={switchAccount}>Use another account</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

