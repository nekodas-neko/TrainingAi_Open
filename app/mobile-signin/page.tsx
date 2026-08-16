"use client";

// Opened by the Capacitor app inside a Chrome Custom Tab.
// Immediately triggers the Google OAuth flow so the user only sees
// Google's sign-in page — not an intermediate UI screen.
// After auth, NextAuth redirects to /auth-mobile-bridge which produces
// the trainingai:// deep link that returns control to the app.

import { useEffect } from "react";
import { signIn } from "next-auth/react";

export default function MobileSignInPage() {
  useEffect(() => {
    const challenge = new URLSearchParams(window.location.search).get("challenge") ?? "";
    signIn("google", {
      callbackUrl: `/auth-mobile-bridge?challenge=${encodeURIComponent(challenge)}`,
    });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground text-sm">Redirecting to Google…</p>
    </div>
  );
}
