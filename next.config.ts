import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
// На превью Vercel показывает свою панель комментариев (vercel.live) — разрешаем её только там
const isPreview = process.env.VERCEL_ENV === "preview";
const vercelLive = isPreview ? " https://vercel.live" : "";
const vercelLiveWs = isPreview ? " wss://ws-us3.pusher.com https://*.pusher.com" : "";

/**
 * Content Security Policy без nonce: так страницы остаются статическими и быстрыми.
 * 'unsafe-inline' для скриптов нужен Next.js (встроенные скрипты гидратации, JSON-LD);
 * главная защита здесь — откуда можно грузить код и куда можно ходить по сети.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${vercelLive}`,
  "style-src 'self' 'unsafe-inline'",
  // Supabase: API, авторизация, хранилище резюме (fetch) и realtime (wss)
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co${vercelLive}${vercelLiveWs}`,
  `img-src 'self' blob: data:${vercelLive} https://vercel.com`,
  "font-src 'self' data:",
  `frame-src 'self'${vercelLive}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Только HTTPS на два года, включая поддомены
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
