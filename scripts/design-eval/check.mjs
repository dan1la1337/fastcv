// Детерминированные проверки перед раундом: axe, горизонтальный скролл, ошибки консоли.
// `node check.mjs --baseline` записывает ошибки консоли базовой сборки.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { WORK, startServer } from "./lib.mjs";
import { walk } from "./scenes.mjs";

const baselinePath = resolve(WORK, "base/console.json");
const writeBaseline = process.argv.includes("--baseline");
const known = !writeBaseline && existsSync(baselinePath) ? new Set(JSON.parse(readFileSync(baselinePath, "utf8"))) : new Set();
const normal = text => text.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>").replace(/\d+/g, "N");

const axe = [], overflow = [], fresh = new Set(), seen = new Set();
const stop = await startServer();
try {
  const { blocked, failed } = await walk({
    onScene: async ({ page, device, scene, consoleErrors }) => {
      const where = `${device}/${scene.id}`;
      const { violations } = await new AxeBuilder({ page }).analyze();
      for (const v of violations) {
        if (v.impact === "serious" || v.impact === "critical") axe.push({ where, rule: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" ")?.slice(0, 100) });
      }
      if (device === "mobile") {
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (wide > 0) overflow.push(`${where}: +${wide}px`);
      }
      for (const text of consoleErrors) {
        const key = normal(text);
        seen.add(key);
        if (!known.has(key)) fresh.add(`${where}: ${text}`);
      }
    },
  });
  if (writeBaseline) {
    mkdirSync(resolve(WORK, "base"), { recursive: true });
    writeFileSync(baselinePath, JSON.stringify([...seen].sort(), null, 2));
  }
  const rules = {};
  for (const a of axe) (rules[`${a.impact} ${a.rule}`] ??= []).push(a.where);
  console.log(`axe serious/critical: ${axe.length}`);
  for (const [rule, where] of Object.entries(rules)) console.log(`  ${rule}: ${where.length} (${where.slice(0, 6).join(", ")})`);
  console.log(`горизонтальный скролл: ${overflow.length}`, overflow);
  console.log(`новые ошибки консоли: ${writeBaseline ? "(базовая запись)" : fresh.size}`, writeBaseline ? [...seen].slice(0, 8) : [...fresh].slice(0, 8));
  console.log("заблокированная запись:", blocked);
  if (failed.length) console.log("не отработали:", failed);
  writeFileSync(resolve(WORK, "last-check.json"), JSON.stringify({ axe, overflow, fresh: [...fresh], failed }, null, 2));
  const bad = axe.length + overflow.length + failed.length + (writeBaseline ? 0 : fresh.size);
  console.log(bad ? "CHECK: FAIL" : "CHECK: PASS");
  process.exitCode = bad ? 1 : 0;
} finally {
  stop();
}
