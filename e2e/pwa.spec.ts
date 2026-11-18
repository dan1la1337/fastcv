import { expect, test } from "@playwright/test";

// Сайт можно добавить на главный экран: манифест с иконками, цвет темы, иконка для iOS
test("манифест приложения, цвет темы и apple-touch-icon", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const manifestHref = html.match(/<link rel="manifest" href="([^"]+)"/)?.[1];
  expect(manifestHref).toBe("/manifest.webmanifest");
  expect(html).toMatch(/<meta name="theme-color" content="#050506"/);
  const appleIcon = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/)?.[1];
  expect(appleIcon, "нет apple-touch-icon").toBeTruthy();

  const response = await request.get(manifestHref!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = await response.json();
  expect(manifest).toMatchObject({ short_name: "FastCV", start_url: "/", display: "standalone", theme_color: "#050506" });
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);

  for (const src of [...manifest.icons.map((i: { src: string }) => i.src), appleIcon!.replace(/&amp;/g, "&")]) {
    const icon = await request.get(src);
    expect(icon.status(), src).toBe(200);
    expect(icon.headers()["content-type"], src).toBe("image/png");
  }
});
