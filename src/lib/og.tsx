import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Картинка для репостов (Telegram, VK, соцсети): 1200×630 — формат Open Graph. */
export const OG_SIZE = { width: 1200, height: 630 };

// Onest из npm-пакета, как на сайте. ImageResponse не читает woff2 и вариативные шрифты,
// поэтому здесь статические начертания в woff из @fontsource/onest: кириллица и латиница
// Пути — литералами: по ним сборка находит файлы и кладёт в серверную функцию только их.
// У каждого набора символов своё имя семейства: с одним именем на всех ImageResponse брал
// для латиницы только первое начертание. latin-ext — ради знака рубля
const FONT_FILES = [
  ["Onest Latin", 400, "node_modules/@fontsource/onest/files/onest-latin-400-normal.woff"],
  ["Onest Latin", 600, "node_modules/@fontsource/onest/files/onest-latin-600-normal.woff"],
  ["Onest Cyrillic", 400, "node_modules/@fontsource/onest/files/onest-cyrillic-400-normal.woff"],
  ["Onest Cyrillic", 600, "node_modules/@fontsource/onest/files/onest-cyrillic-600-normal.woff"],
  ["Onest Latin Ext", 400, "node_modules/@fontsource/onest/files/onest-latin-ext-400-normal.woff"],
  ["Onest Latin Ext", 600, "node_modules/@fontsource/onest/files/onest-latin-ext-600-normal.woff"],
] as const;
const fonts = Promise.all(
  FONT_FILES.map(async ([name, weight, file]) => ({
    name,
    data: await readFile(join(process.cwd(), file)),
    weight,
    style: "normal" as const,
  })),
);

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * Карточка в стиле сайта (Obsidian Glass): тёмный фон, мятный акцент, логотип FastCV.
 * kicker — строка над заголовком, facts — строка фактов под ним (зарплата, город, формат).
 */
export async function ogCard({ kicker, title, facts }: { kicker: string; title: string; facts: string[] }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
          padding: "64px 72px", fontFamily: "Onest Latin, Onest Cyrillic, Onest Latin Ext", color: "#f4f4f5",
          backgroundColor: "#050506",
          backgroundImage: "radial-gradient(circle at 85% 15%, rgba(94,234,212,0.18), transparent 55%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 40, fontWeight: 600 }}>FastCV</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 30, color: "#5eead4" }}>{clip(kicker, 60)}</div>
          <div style={{ display: "flex", fontSize: title.length > 60 ? 56 : 68, fontWeight: 600, lineHeight: 1.15 }}>
            {clip(title, 110)}
          </div>
          {facts.length > 0 && (
            <div style={{ display: "flex", fontSize: 32, color: "#c4c4ca" }}>{clip(facts.join(" · "), 70)}</div>
          )}
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#9b9ca4" }}>Вакансии с откликом от ИИ · fastcv.ru</div>
      </div>
    ),
    { ...OG_SIZE, fonts: await fonts },
  );
}
