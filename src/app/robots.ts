import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Личные кабинеты и служебные страницы индексировать незачем
      disallow: ["/api/", "/profile", "/applications", "/employer", "/admin", "/messages", "/feedback/", "/welcome", "/auth/", "/login", "/register"],
    },
    sitemap: "https://fastcv.ru/sitemap.xml",
  };
}
