import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { cookies } from "next/headers";
import { mintMobileBridgeToken } from "@/lib/mobile-auth-bridge";
import { MobileBridgeRedirect } from "./redirect-client";

export default async function AuthMobileBridgePage({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const { challenge } = await searchParams;
  const token = mintMobileBridgeToken(challenge, await cookies());
  if (!token) redirect("/sign-in");

  // Render a client component that uses window.location.href — the only
  // reliable way to fire a custom URL scheme from a Chrome Custom Tab.
  return <MobileBridgeRedirect token={token} />;
}
