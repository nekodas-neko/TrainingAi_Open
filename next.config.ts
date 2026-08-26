import type { NextConfig } from "next";
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

export default nextConfig;
