// Снимает все экраны на десктопе и телефоне: `node capture.mjs <папка>`.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { WORK, startServer } from "./lib.mjs";
import { walk } from "./scenes.mjs";

const out = resolve(process.argv[2] ?? resolve(WORK, "captures/latest"));
const only = process.argv[3]?.split(",");
const stop = await startServer();
try {
  const taken = [];
  const contacts = [];
  const { blocked, failed } = await walk({
    only,
    onScene: async ({ page, device, scene }) => {
      mkdirSync(resolve(out, device), { recursive: true });
      await page.screenshot({ path: resolve(out, device, `${scene.id}.png`), fullPage: false, animations: "disabled" });
      taken.push(`${device}/${scene.id}`);
      // Адреса уже скрыты; всё, что осталось похожим на контакт, pack не пропустит
      const text = await page.evaluate(() => document.body.innerText);
      const found = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+|\+7[\s(-]*\d{3}[\s)-]*\d{3}/g)?.filter(m => m !== "test@example.com") ?? [];
      if (found.length) contacts.push(`${device}/${scene.id}: ${found.length}`);
    },
  });
  writeFileSync(resolve(out, "capture.json"), JSON.stringify({ taken, blocked, failed, contacts }, null, 2));
  console.log(`снято ${taken.length}, ошибок ${failed.length}`);
  console.log("заблокированная запись:", blocked);
  if (contacts.length) console.log("контакты на экране:", contacts);
  if (failed.length) { console.log(failed.join("\n")); process.exitCode = 1; }
} finally {
  stop();
}
