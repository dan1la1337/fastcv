// Общее для harness: окружение, проверка staging, запуск сайта, вход, подготовка страницы.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "../..");
export const WORK = resolve(REPO, "../fastcv-ui-climb");
export const PORT = Number(process.env.EVAL_PORT ?? 3200);
export const BASE_URL = `http://localhost:${PORT}`;

const PRODUCTION_REF = "wyanvkaoqxgceaxzlqvk";
const STAGING_REF = "zcyccnlweanhcsumplbx";

export const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
};

export const AXES = {
  visual_hierarchy: "visual hierarchy", typography: "typography", colour_contrast: "colour and contrast",
  spacing_layout: "spacing and layout", component_consistency: "component consistency", iconography: "iconography",
  flow_clarity: "flow clarity", states_feedback: "states and feedback", copy: "copy", accessibility: "accessibility",
  responsive: "responsive behaviour", polish: "polish",
};

/** Значения .env.local. Останавливает работу, если файл указывает не на staging. */
export function loadEnv() {
  const path = resolve(REPO, ".env.local");
  if (!existsSync(path)) throw new Error(".env.local не найден");
  const text = readFileSync(path, "utf8");
  if (text.includes(PRODUCTION_REF)) throw new Error("STOP: в .env.local указан рабочий проект");
  if (!text.includes(STAGING_REF)) throw new Error("STOP: в .env.local нет staging-проекта");
  const env = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0 && !line.startsWith("#")) env[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  for (const name of ["E2E_CANDIDATE_EMAIL", "E2E_CANDIDATE_PASSWORD", "E2E_EMPLOYER_EMAIL", "E2E_EMPLOYER_PASSWORD"]) {
    if (!env[name]) throw new Error(`Нет ${name} в .env.local`);
  }
  return env;
}

export function accounts(env) {
  return {
    candidate: { email: env.E2E_CANDIDATE_EMAIL, password: env.E2E_CANDIDATE_PASSWORD },
    employer: { email: env.E2E_EMPLOYER_EMAIL, password: env.E2E_EMPLOYER_PASSWORD },
  };
}

/** Поднимает `next start` на собранном сайте и возвращает функцию остановки. */
export async function startServer({ cwd = REPO, port = PORT } = {}) {
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: "ignore", detached: true,
  });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${url}/login`);
      if (res.ok) return () => { try { process.kill(-child.pid, "SIGTERM"); } catch { /* уже остановлен */ } };
    } catch { /* ещё не готов */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("next start не ответил за 60 секунд");
}

export async function login(page, account, baseUrl = BASE_URL) {
  await page.goto(`${baseUrl}/login`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

/** Ждём шрифты и сеть, скрываем живые числа и подменяем адреса почты на нейтральный. */
export async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "[data-live-stats]{visibility:hidden !important}" }).catch(() => {});
  await hideEmails(page);
  await page.waitForTimeout(150);
}

export async function hideEmails(page) {
  await page.evaluate(() => {
    const mail = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (mail.test(node.nodeValue)) node.nodeValue = node.nodeValue.replace(mail, "test@example.com");
      mail.lastIndex = 0;
    }
    for (const input of document.querySelectorAll("input, textarea")) {
      if (input.type !== "password" && mail.test(input.value)) input.value = input.value.replace(mail, "test@example.com");
      mail.lastIndex = 0;
    }
  });
}
