"use client";

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
