import type { NextConfig } from "next";

// Content-Security-Policy с nonce ставит src/proxy.ts (см. src/lib/csp.ts): nonce новый на каждый запрос
const securityHeaders = [
  // Только HTTPS на два года, включая поддомены
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Прокси к Supabase для браузера: см. SUPABASE_PROXY_PATH в src/lib/supabase.ts
  async rewrites() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    return supabaseUrl ? [{ source: "/sb/:path*", destination: `${supabaseUrl}/:path*` }] : [];
  },
  async redirects() {
    // Описание сервиса теперь на главной; адрес сохраняем для старых ссылок и поисковиков
    return [{ source: "/about", destination: "/", permanent: true }];
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
