// Сводка Lighthouse в Markdown: медианный запуск по каждой странице, баллы
// категорий и ссылка на полный отчёт. Читает результаты @lhci/cli из .lighthouseci/.
import { existsSync, readdirSync, readFileSync } from "node:fs";

const dir = ".lighthouseci";
const runs = existsSync(dir)
  ? readdirSync(dir).filter(f => /^lhr-.*\.json$/.test(f)).map(f => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")))
  : [];
const links = existsSync(`${dir}/links.json`) ? JSON.parse(readFileSync(`${dir}/links.json`, "utf8")) : {};

const CATEGORIES = [["performance", "Скорость"], ["accessibility", "Доступность"], ["best-practices", "Практики"], ["seo", "SEO"]];
const score = (lhr, id) => Math.round((lhr.categories[id]?.score ?? 0) * 100);
const mark = n => (n >= 90 ? "🟢" : n >= 50 ? "🟠" : "🔴") + " " + n;

const byUrl = new Map();
for (const lhr of runs) {
  const url = lhr.requestedUrl;
  byUrl.set(url, [...(byUrl.get(url) ?? []), lhr]);
}

const lines = ["### Lighthouse, мобильный (медиана из запусков)", ""];
if (!byUrl.size) {
  lines.push("Lighthouse не отработал — см. лог запуска.");
} else {
  lines.push(`| Страница | ${CATEGORIES.map(([, name]) => name).join(" | ")} | LCP | Отчёт |`);
  lines.push(`|---|${CATEGORIES.map(() => "---").join("|")}|---|---|`);
  for (const [url, list] of byUrl) {
    const sorted = [...list].sort((a, b) => score(a, "performance") - score(b, "performance"));
    const median = sorted[Math.floor(sorted.length / 2)];
    const lcp = median.audits["largest-contentful-paint"]?.displayValue ?? "—";
    const report = links[url] ? `[открыть](${links[url]})` : "—";
    lines.push(`| ${url.replace("https://fastcv.ru", "") || "/"} | ${CATEGORIES.map(([id]) => mark(score(median, id))).join(" | ")} | ${lcp} | ${report} |`);
  }
  lines.push("", "Цель плана — не ниже 90 по скорости и доступности. Ссылки на отчёты живут несколько дней.");
}
console.log(lines.join("\n"));
