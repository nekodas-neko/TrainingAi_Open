import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { cookies } from "next/headers";
import { createMobileAuthToken } from "@/lib/mobile-auth-tokens";
import { PKCE_CHALLENGE_RE } from "@/lib/pkce";
import { MobileBridgeRedirect } from "./redirect-client";

export default async function AuthMobileBridgePage({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const { challenge } = await searchParams;
  if (!challenge || !PKCE_CHALLENGE_RE.test(challenge)) redirect("/sign-in");

  const cookieStore = await cookies();
  const sessionCookie =
    cookieStore.get("__Secure-authjs.session-token") ??
    cookieStore.get("authjs.session-token");

  if (!sessionCookie?.value) redirect("/sign-in");

  const token = createMobileAuthToken(sessionCookie.value, challenge);
  // Render a client component that uses window.location.href — the only
  // reliable way to fire a custom URL scheme from a Chrome Custom Tab.
  return <MobileBridgeRedirect token={token} />;
}
