import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === 'development';

const csp = [
  "default-src 'self'",
  // 'unsafe-inline': Next.js App Router emits inline bootstrap/Flight scripts
  // and we have no middleware to attach nonces (follow-up). 'unsafe-eval' is
  // dev-only — Turbopack/React Refresh need eval for HMR; production does not.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://accounts.google.com`,
  // 'unsafe-inline' styles: motion/Radix/next-themes set inline style
  // attributes (Tailwind itself is a compiled stylesheet and doesn't need it).
  "style-src 'self' 'unsafe-inline'",
  // raw.githubusercontent.com: the exercise dataset's GIFs and stills, rendered as plain <img src>
  // by exercise-stats-sheet.tsx and written into exercise_library by seed-exercise-gifs. The host
  // was in images.remotePatterns below but in neither directive here, so every exercise without an
  // S3 GIF (getThumbnail's same-origin proxy path) showed nothing at all.
  "img-src 'self' data: blob: https://raw.githubusercontent.com https://*.tile.openstreetmap.org https://*.tile.thunderforest.com https://lh3.googleusercontent.com https://lh4.googleusercontent.com https://lh5.googleusercontent.com https://lh6.googleusercontent.com",
  "font-src 'self'",
  // Tile domains: the service worker's fetch handler re-issues fetch() for every request
  // (including cross-origin tile <img> loads) to populate its cache — a fetch() call made
  // from inside a service worker is governed by connect-src, not img-src, regardless of the
  // resource type. img-src alone (above) covers a direct <img> load but not the SW's own
  // re-fetch of that same request, so both must be listed here too or the SW's fetch is
  // silently CSP-blocked and every tile request fails.
  // raw.githubusercontent.com is here for the same reason the tile domains are — the SW's re-fetch,
  // not the <img> itself. Listing it only in img-src reproduces the exact bug this comment
  // describes, one host later.
  "connect-src 'self' https://generativelanguage.googleapis.com https://accounts.google.com https://oauth2.googleapis.com https://cloud.ouraring.com https://api.ouraring.com https://api.open-meteo.com https://geocoding-api.open-meteo.com https://raw.githubusercontent.com https://*.tile.openstreetmap.org https://*.tile.thunderforest.com wss: ws:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
].join('; ');

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
