"use client";

import { Button } from "@/components/ui/button";
import { signIn } from "next-auth/react";

const RAILWAY_URL = "https://trainingai-production.up.railway.app";
export const MOBILE_AUTH_VERIFIER_KEY = "ta-mobile-auth-verifier";

function base64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function GoogleSignIn() {
  async function handleSignIn() {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import("@capacitor/browser");
      // PKCE-style binding: the verifier never leaves this WebView's
      // localStorage; only its SHA-256 challenge rides the OAuth flow, so an
      // app intercepting the trainingai:// deep link can't redeem the token.
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
      );
      const challenge = base64url(digest);
      localStorage.setItem(MOBILE_AUTH_VERIFIER_KEY, verifier);
      await Browser.open({ url: `${RAILWAY_URL}/mobile-signin?challenge=${challenge}` });
    } else {
      signIn("google", { callbackUrl: "/" });
    }
  }

  return (
    <Button
      onClick={handleSignIn}
      className="w-full py-3 text-lg"
      variant="outline"
    >
      <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
      Sign in with Google
    </Button>
  );
}
