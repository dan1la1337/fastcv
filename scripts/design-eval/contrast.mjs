// Контраст текста на настоящих стеклянных поверхностях: `node contrast.mjs [порог]`.
// axe не считает контраст поверх градиентов и зерна, поэтому фон снимается пикселями:
// текст делается прозрачным, под каждой строкой берётся самый неудобный для неё фон.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { WORK, startServer } from "./lib.mjs";
import { walk } from "./scenes.mjs";

const NEED = Number(process.argv[2] ?? 4.5), LARGE = 3;
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const collect = () => {
  const items = [];
  // Tailwind 4 отдаёт цвета в lab(): холст приводит их к sRGB
  const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  const toRgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return `rgba(${r},${g},${b},${a / 255})`; };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (!text) continue;
    const el = node.parentElement;
    if (el.closest("[aria-hidden='true'],[disabled],script,style,noscript")) continue;
    const css = getComputedStyle(el);
    if (css.visibility !== "visible" || css.display === "none") continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of [...range.getClientRects()].slice(0, 1)) {
      if (r.width < 4 || r.height < 4 || r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
      // Строка хотя бы частично под фиксированной панелью не считается: её там не прочитать
      const covered = [[.5, .5], [.1, .2], [.9, .2], [.1, .8], [.9, .8]].some(([fx, fy]) => {
        const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
        return hit && !el.contains(hit) && !hit.contains(el);
      });
      if (covered) continue;
      let opacity = 1;
      for (let e = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
      items.push({ text: text.slice(0, 40), color: toRgba(css.color), opacity, size: parseFloat(css.fontSize), weight: Number(css.fontWeight), x: r.left, y: r.top, w: r.width, h: r.height, cls: String(el.className).slice(0, 80) });
    }
  }
  return items;
};

const parse = c => { const m = c.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m[3] ?? 1 }; };
const fails = new Map();
const stop = await startServer();
try {
  const { failed } = await walk({
    onScene: async ({ page, device, scene }) => {
      const dsf = device === "mobile" ? 1.5 : 1;
      const items = await page.evaluate(collect);
      const style = await page.addStyleTag({ content: "*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;caret-color:transparent!important;text-shadow:none!important;transition:none!important}" });
      const shot = await page.screenshot({ scale: "device" });
      await style.evaluate(n => n.remove());
      const raw = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const px = (x, y) => { const i = (Math.round(y) * raw.info.width + Math.round(x)) * 3; return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]; };
      for (const it of items) {
        const fg = parse(it.color);
        if (!fg.rgb || fg.a * it.opacity === 0) continue;
        let worst = Infinity, bgWorst = null;
        for (let i = 0; i < 12; i++) for (let j = 0; j < 3; j++) {
          const x = (it.x + it.w * (i + .5) / 12) * dsf, y = (it.y + it.h * (j + .5) / 3) * dsf;
          if (x >= raw.info.width || y >= raw.info.height) continue;
          const bg = px(x, y);
          const alpha = fg.a * it.opacity;
          const shown = fg.rgb.map((v, k) => v * alpha + bg[k] * (1 - alpha));
          const r = ratio(shown, bg);
          if (r < worst) { worst = r; bgWorst = bg; }
        }
        const large = it.size >= 24 || (it.size >= 18.66 && it.weight >= 600);
        if (worst < (large ? LARGE : NEED)) {
          const key = `${it.color}|${it.cls}`;
          const row = fails.get(key) ?? { ratio: worst, color: it.color, bg: bgWorst, size: it.size, cls: it.cls, text: it.text, where: new Set() };
          row.ratio = Math.min(row.ratio, worst);
          row.where.add(`${device}/${scene.id}`);
          fails.set(key, row);
        }
      }
    },
  });
  if (failed.length) console.log("сбои сцен:", failed);
} finally {
  await stop();
}
const rows = [...fails.values()].sort((a, b) => a.ratio - b.ratio).map(r => ({ ...r, ratio: Number(r.ratio.toFixed(2)), where: [...r.where] }));
writeFileSync(resolve(WORK, "last-contrast.json"), JSON.stringify(rows, null, 2));
for (const r of rows.slice(0, 40)) console.log(r.ratio, r.color, "на", r.bg.join(","), `${r.size}px`, JSON.stringify(r.text), `[${r.where.length}: ${r.where[0]}]`, r.cls.slice(0, 50));
console.log(rows.length ? `CONTRAST: FAIL ${rows.length}` : "CONTRAST: PASS");
