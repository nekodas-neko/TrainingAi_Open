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
