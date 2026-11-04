// Один проход по публичным страницам референсов. Без входа и без обхода блокировок:
// если сайт не пускает, снимок пропускается и об этом пишется в references.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { DEVICES, WORK } from "./lib.mjs";

const SITES = {
  "hh.ru": { home: "https://hh.ru/", search: "https://hh.ru/search/vacancy?text=python", vacancyLink: 'a[href*="/vacancy/"]', locale: "ru-RU" },
  "career.habr.com": { home: "https://career.habr.com/", search: "https://career.habr.com/vacancies?q=python&type=all", vacancyLink: 'a[href^="/vacancies/"][href*="0"]', locale: "ru-RU" },
  "welcometothejungle.com": { home: "https://www.welcometothejungle.com/en", search: "https://www.welcometothejungle.com/en/jobs?query=python", vacancyLink: 'a[href*="/jobs/"]', locale: "en-US" },
};
const pause = () => new Promise(r => setTimeout(r, 6000 + Math.random() * 3000));
const out = resolve(WORK, "references");
const log = [];

const browser = await chromium.launch();
for (const [site, cfg] of Object.entries(SITES)) {
  for (const [device, options] of Object.entries(DEVICES)) {
    const context = await browser.newContext({ ...options, reducedMotion: "reduce", locale: cfg.locale });
    const page = await context.newPage();
    const folder = resolve(out, site, device);
    mkdirSync(folder, { recursive: true });
    const shot = async (name, url) => {
      try {
        const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: resolve(folder, `${name}.png`), animations: "disabled" });
        log.push({ site, device, name, status: res?.status(), title: (await page.title()).slice(0, 80), url: page.url().slice(0, 120) });
      } catch (error) {
        log.push({ site, device, name, error: String(error.message).split("\n")[0] });
      }
      await pause();
    };
    await shot("home", cfg.home);
    await shot("search", cfg.search);
    const href = await page.locator(cfg.vacancyLink).first().getAttribute("href", { timeout: 5000 }).catch(() => null);
    if (href) await shot("vacancy", new URL(href, cfg.search).href);
    else log.push({ site, device, name: "vacancy", error: "ссылка на вакансию не найдена" });
    await context.close();
  }
}
await browser.close();
writeFileSync(resolve(out, "references.json"), JSON.stringify(log, null, 2));
console.log(log);
