import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Static CSP (no nonces, so pages stay statically rendered). Pulse renders
// no HTML from other users — chat is plain text over WebRTC — so the main
// jobs here are: no framing (a page that asks for camera + location must not
// be clickjackable), no plugins, and only Mapbox as a third-party origin.
// Mapbox GL needs blob: workers and data:/blob: images.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.mapbox.com",
  "connect-src 'self' https://*.mapbox.com",
  "worker-src 'self' blob:",
  "child-src blob:",
  "media-src 'self' blob: mediastream:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(self)",
  },
];

const nextConfig: NextConfig = {
  // Extra hosts allowed to reach dev resources (HMR, etc.), e.g. a tunnel.
  // Comma-separated; dev only, never hardcoded.
  allowedDevOrigins: process.env.DEV_ORIGINS?.split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
