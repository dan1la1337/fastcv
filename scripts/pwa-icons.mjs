// Иконки приложения (PWA и apple-touch-icon) из логотипа: надпись FastCV шрифтом Onest 600
// цвета ink на фоне void, как в шапке сайта. Результат кладётся в репозиторий, на сборке не запускается.
//
// Запуск из корня репозитория: node scripts/pwa-icons.mjs
// Нужен статический Onest в woff (ImageResponse не читает woff2): npm i --no-save @fontsource/onest
import { createElement as h } from "react";
import { ImageResponse } from "next/og.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const VOID = "#050506";
const INK = "#f4f4f5";
const font = await readFile(join(process.cwd(), "node_modules/@fontsource/onest/files/onest-latin-600-normal.woff"));

// maskable: система обрезает иконку кругом или скруглённым квадратом — надпись держим в центральных 60%
const ICONS = [
  { file: "public/icons/icon-192.png", size: 192, width: 0.78 },
  { file: "public/icons/icon-512.png", size: 512, width: 0.78 },
  { file: "public/icons/icon-maskable-512.png", size: 512, width: 0.6 },
  { file: "src/app/apple-icon.png", size: 180, width: 0.78 },
];

await mkdir("public/icons", { recursive: true });
for (const { file, size, width } of ICONS) {
  // Ширина надписи FastCV в Onest 600 — около 2,9 кегля
  const fontSize = Math.round((size * width) / 2.9);
  const image = new ImageResponse(
    h("div", {
      style: {
        width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: VOID, color: INK, fontFamily: "Onest", fontWeight: 600, fontSize, letterSpacing: -fontSize * 0.02,
      },
    }, "FastCV"),
    { width: size, height: size, fonts: [{ name: "Onest", data: font, weight: 600, style: "normal" }] },
  );
  await writeFile(file, Buffer.from(await image.arrayBuffer()));
  console.log(file);
}
