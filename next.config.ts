import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { buildCsp } from "./lib/security/csp";

const isDev = process.env.NODE_ENV === 'development';

const csp = buildCsp(isDev);

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self)',
  },
  {
    key: 'Content-Security-Policy',
    value: csp,
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // BF-19. The build that produced THIS client bundle, baked in at build time and read by
  // `lib/app-load-metrics.ts` so a load-time regression can be pinned to a release.
  //
  // **Baked in rather than stamped by the server on ingest, and that distinction is the point.**
  // A device holding a stale shell from an earlier deploy is exactly the case this feature exists
  // to measure — the service worker's cache name is stamped from the deploy SHA, so every merge
  // invalidates it and a slow load is often a shell being re-fetched. Stamping server-side would
  // label such a load with the deploy that is live *now*, not the one the device is running, and
  // the report would attribute the slowness to the wrong release.
  //
  // Absent locally, which is correct: a `pnpm dev` build has no deploy SHA and its timings are not
  // the APK's anyway.
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ?? '',
  },
  // onnxruntime-node is a native addon (Oura neural-model inference, server-side rollup only) —
  // keep it external so Next never tries to bundle its .node binaries.
  serverExternalPackages: ['onnxruntime-node'],
  experimental: {
    optimizePackageImports: ['lucide-react', '@phosphor-icons/react', 'motion/react'],
    // Client router cache: keep visited/prefetched tab payloads for 5 minutes so
    // tab-to-tab navigation reuses them instead of refetching ?_rsc= from the
    // server on every tap (the Next 15 default for dynamic routes is 0 — discard
    // immediately, which made the bottom nav's prefetch={true} useless). Tab
    // pages are thin auth-gating shells; all data renders client-side from the
    // local cache layer, so a minutes-old RSC payload cannot show stale data.
    staleTimes: { dynamic: 300, static: 300 },
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200],
    remotePatterns: [
      { protocol: 'https', hostname: '*.googleusercontent.com' },   // Google OAuth avatars
      { protocol: 'https', hostname: 'raw.githubusercontent.com' }, // exercise dataset media (lib/exercise-gif-matcher.ts DATASET_BASE)
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/icons/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
        ],
      },
    ];
  },
};

// BF-92. Sentry was wired correctly and heard nothing from the browser for 13 days: `connect-src`
// never got the ingest host, so every client event was refused before it left the page — while the
// homegrown reporter, which POSTs same-origin to `/api/client-error`, landed 9 rows over the same
// window on the same device. Same app, same errors, different origin, opposite outcome.
//
// **Tunnelling rather than opening `connect-src` to the ingest host, and the difference matters.**
// `tunnelRoute` rewrites the browser's POST to a same-origin path that `connect-src 'self'` already
// permits, and the server relays it — so this cannot be silently broken again by the next edit to
// `lib/security/csp.ts`, which is exactly how it broke the first time. The alternative was a second
// host in a header whose comments show it has been reasoned about host by host, defended by nothing
// but a comment. `instrumentation-client.ts` carried precisely that comment, predicting precisely
// this failure, and the host was never added: a comment describing a hazard is not a guard.
//
// A fixed path rather than `true` (a fresh random path per build): the route has to be named in
// `middleware.ts`'s matcher to survive the auth gate, and a name that changes every deploy cannot be.
export default withSentryConfig(nextConfig, {
  tunnelRoute: '/monitoring',
  // Our build data is not Sentry's to have. Consistent with `sendDefaultPii: false` and no replay —
  // the reason this vendor was accepted at all was alerting.
  telemetry: false,
  // Uploading needs `SENTRY_AUTH_TOKEN`, which CI does not have and should not. Without this the
  // plugin warns on every build about work it cannot do, and a warning nobody can action is noise
  // that hides the ones that matter. `deleteSourcemapsAfterUpload` keeps the maps off the public
  // origin when the token IS present, so a stack trace is readable in Sentry without shipping the
  // sources to anyone who asks for them.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
});
