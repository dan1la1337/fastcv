import type { MetadataRoute } from "next";

// Цвета — фон сайта (void из globals.css): заставка при запуске и полоса браузера без вспышки
export const THEME_COLOR = "#050506";

/** Манифест приложения: FastCV можно добавить на главный экран телефона. Иконки — scripts/pwa-icons.mjs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FastCV — вакансии с откликом от ИИ",
    short_name: "FastCV",
    description: "Свежие вакансии из Telegram-каналов и от прямых работодателей. Сопроводительное письмо под каждую вакансию пишет ИИ.",
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
