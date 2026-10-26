import path from 'node:path';

import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Internal tool: never indexed.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // This app has its own lockfile inside the monorepo.
  turbopack: { root: path.join(__dirname) },
  // Local dev/e2e use http://127.0.0.1:3102 (dev-server assets are origin-checked).
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
