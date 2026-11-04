// Экраны и шаги сценариев. capture снимает их, check проверяет — один список на оба.
// Всё только читает: guard() не выпускает из браузера ни одной записи.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { BASE_URL, DEVICES, HERE, accounts, loadEnv, login, settle } from "./lib.mjs";

export const data = JSON.parse(readFileSync(resolve(HERE, "data.json"), "utf8"));

// RPC, которые только читают. Всё, чего здесь нет, не уходит в базу и попадает в журнал.
const READ_RPC = new Set([
  "company_rating", "employer_reviews", "excluded_channels", "is_app_admin", "live_stats",
  "my_application_funnel", "my_application_matches", "my_closed_report", "my_conversations",
  "my_hiring_reviews", "my_interview_ratings", "my_upcoming_interviews", "my_vacancy_matches",
  "recommended_vacancies", "resume_board", "unread_conversations",
]);

const LETTER = "Здравствуйте! Пишу на Python четыре года: Django, PostgreSQL, очереди. Хочу в вашу команду и готов обсудить задачи ядра.";

/** Перехват сети: чтение проходит, запись гасится здесь и записывается в журнал. */
export async function guard(context, blocked) {
  await context.route("**/*", route => {
    const request = route.request();
    const method = request.method();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return route.continue();
    const url = new URL(request.url());
    // Браузер ходит в Supabase через прокси сайта /sb (next.config.ts)
    const path = url.pathname.replace(/^\/sb(?=\/)/, "");
    if (path === "/auth/v1/token") return route.continue();
    const rpc = path.match(/^\/rest\/v1\/rpc\/(.+)$/)?.[1];
    if (rpc && READ_RPC.has(rpc)) return route.continue();
    if (path === "/api/cover-letter") return route.fulfill({ json: { text: LETTER, source: "ai" } });
    blocked.add(`${method} ${path}`);
    return route.fulfill({ status: 200, json: [] });
  });
}

async function scroll(page, share = 0.85) {
  await page.evaluate(s => window.scrollBy({ top: innerHeight * s, behavior: "instant" }), share);
  await page.waitForTimeout(250);
}

async function centre(locator) {
  await locator.evaluate(el => el.scrollIntoView({ block: "center", behavior: "instant" }));
}

async function openFilters(page) {
  const toggle = page.locator('button[aria-expanded]').filter({ hasText: /Фильтры/ }).first();
  if (await toggle.isVisible().catch(() => false) && await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
}

async function search(page, text) {
  await page.goto(`${BASE_URL}/`);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await openFilters(page);
  const box = page.getByPlaceholder("Java, Backend...");
  await box.fill(text);
  await page.waitForTimeout(1200);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
}

async function openSmartApply(page) {
  await search(page, "Senior Python-разработчик");
  await page.getByRole("button", { name: /Smart Apply/ }).first().click();
  await page.getByRole("button", { name: "Написать письмо" }).waitFor({ timeout: 10_000 });
}

export function scenes() {
  const go = path => page => page.goto(`${BASE_URL}${path}`);
  return [
    // Гость
    { id: "home", as: "guest", run: go("/") },
    { id: "home-scrolled", as: "guest", run: async p => { await go("/")(p); await scroll(p); } },
    { id: "jobs", as: "guest", run: go("/jobs") },
    { id: "jobs-direction", as: "guest", run: go(`/jobs/${data.direction}`) },
    { id: "vacancy", as: "guest", run: go(`/vacancy/${data.vacancyId}`) },
    { id: "vacancy-scrolled", as: "guest", run: async p => { await go(`/vacancy/${data.vacancyId}`)(p); await scroll(p); } },
    { id: "company", as: "guest", run: go(`/company/${encodeURIComponent(data.company)}`) },
    { id: "about", as: "guest", run: go("/about") },
    { id: "login", as: "guest", run: go("/login") },
    { id: "register", as: "guest", run: go("/register") },
    { id: "register-form", as: "guest", run: go("/register/form?role=candidate") },
    { id: "not-found", as: "guest", run: go("/no-such-page") },
    // Состояния и шаги сценария гостя
    { id: "feed-filtered", as: "guest", run: async p => { await search(p, data.filterQuery); await centre(p.getByRole("button", { name: /Smart Apply/ }).first()); } },
    { id: "feed-empty", as: "guest", run: async p => { await search(p, data.emptyQuery); const empty = p.getByText("Ничего не нашлось"); await empty.waitFor({ timeout: 10_000 }); await centre(empty); } },
    { id: "form-error", as: "guest", run: async p => {
      await p.route("**/auth/v1/token*", route => route.fulfill({ status: 400, json: { error_code: "invalid_credentials", msg: "Invalid login credentials" } }));
      await go("/login")(p);
      await p.locator('input[type="email"]').fill("test@example.com");
      await p.locator('input[type="password"]').fill("wrong-password");
      await p.getByRole("button", { name: "Войти" }).click();
      await p.waitForTimeout(600);
      await p.unroute("**/auth/v1/token*");
    } },
    // Кандидат
    { id: "for-you", as: "candidate", run: async p => { await go("/")(p); await p.getByRole("tab", { name: "Для вас" }).waitFor({ timeout: 15_000 }); await p.locator('a[href^="/vacancy/"]').first().waitFor({ timeout: 20_000 }); } },
    { id: "applications", as: "candidate", run: go("/applications") },
    { id: "messages", as: "candidate", run: async p => { await go("/messages")(p); await p.getByRole("list", { name: "Диалоги" }).getByRole("button").first().click(); await p.getByRole("log").waitFor({ timeout: 10_000 }); } },
    { id: "profile", as: "candidate", run: go("/profile") },
    { id: "candidate-resumes", as: "candidate", run: go("/resumes") },
    { id: "practice", as: "candidate", run: go(`/practice/${data.practiceVacancyId}`) },
    { id: "smart-apply", as: "candidate", run: openSmartApply },
    { id: "smart-apply-letter", as: "candidate", run: async p => { await openSmartApply(p); await p.getByRole("button", { name: "Написать письмо" }).click(); await p.locator('textarea[id^="letter-"]').waitFor({ timeout: 15_000 }); await p.waitForTimeout(400); } },
    { id: "focus-main-action", as: "candidate", run: async p => { await go(`/vacancy/${data.vacancyId}`)(p); const cta = p.getByRole("button", { name: "Написать письмо" }); await cta.waitFor({ timeout: 10_000 }); await p.keyboard.press("Tab"); await cta.focus(); } },
    // Работодатель
    { id: "employer", as: "employer", run: go("/employer") },
    { id: "employer-review", as: "employer", run: async p => { await go("/employer")(p); await p.getByRole("button", { name: "Сначала новые" }).click(); await p.locator("div.glass").filter({ hasText: "Backend-разработчик (Python, FastAPI)" }).getByRole("button", { name: "Пригласить" }).first().scrollIntoViewIfNeeded(); } },
    { id: "employer-decision", as: "employer", run: async p => { await go("/employer")(p); await p.getByRole("button", { name: "Сначала новые" }).click(); const card = p.locator("div.glass").filter({ hasText: "Backend-разработчик (Python, FastAPI)" }).filter({ has: p.getByRole("button", { name: "Пригласить" }) }).first(); await card.getByRole("button", { name: "Пригласить" }).click(); await card.getByRole("button", { name: "Отправить", exact: true }).waitFor({ timeout: 5000 }); await card.getByRole("button", { name: "Отправить", exact: true }).scrollIntoViewIfNeeded(); } },
    { id: "employer-resumes", as: "employer", run: go("/resumes") },
  ];
}

/** Шаги сценариев: кадры берутся из тех же экранов, порядок — порядок действий пользователя. */
export const FLOWS = {
  "guest-finds-vacancy": ["home", "feed-filtered", "vacancy"],
  "candidate-smart-apply": ["for-you", "smart-apply", "smart-apply-letter"],
  "employer-decision": ["employer", "employer-review", "employer-decision"],
  "new-user-registers": ["home", "register", "register-form"],
};

/** Обходит все экраны на обоих устройствах и вызывает onScene на подготовленной странице. */
export async function walk({ onScene, only, devices = Object.keys(DEVICES) }) {
  const env = loadEnv();
  const who = accounts(env);
  const blocked = new Set();
  const failed = [];
  const browser = await chromium.launch();
  try {
    for (const device of devices) {
      const contexts = {};
      const open = async as => {
        if (contexts[as]) return contexts[as];
        const context = await browser.newContext({ ...DEVICES[device], reducedMotion: "reduce", locale: "ru-RU", timezoneId: "Europe/Moscow" });
        await guard(context, blocked);
        if (as !== "guest") { const page = await context.newPage(); await login(page, who[as]); await page.close(); }
        contexts[as] = context;
        return context;
      };
      for (const scene of scenes()) {
        if (only && !only.includes(scene.id)) continue;
        const context = await open(scene.as);
        const page = await context.newPage();
        const consoleErrors = [];
        page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 240)); });
        page.on("pageerror", e => consoleErrors.push(String(e.message).slice(0, 240)));
        try {
          await scene.run(page);
          await settle(page);
          await onScene({ page, device, scene, consoleErrors });
        } catch (error) {
          failed.push(`${device}/${scene.id}: ${String(error.message).split("\n")[0]}`);
        }
        await page.close();
      }
      for (const context of Object.values(contexts)) await context.close();
    }
  } finally {
    await browser.close();
  }
  return { blocked: [...blocked].sort(), failed };
}
