// Собирает пакет раунда: `node pack.mjs <раунд> [папка снимков] [--allow-missing]`.
// Лимит пакета — меньше 60 картинок и 15 МБ на две сборки и референсы, поэтому кадры
// складываются в листы: две вкладки на десктопе, три на телефоне. Исходные снимки остаются
// по одному на экран и шаг в папке capture.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { AXES, HERE, REPO, WORK } from "./lib.mjs";
import { FLOWS, scenes } from "./scenes.mjs";

const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const allowMissing = process.argv.includes("--allow-missing");
const round = args[0];
if (round === undefined) throw new Error("Нужен номер раунда");
const current = resolve(args[1] ?? resolve(WORK, "captures/latest"));
const baseDir = resolve(WORK, "base/capture");
const refsDir = resolve(WORK, "references");
const roundDir = resolve(WORK, `round-${round}`);
const packDir = resolve(roundDir, "pack");

const LONG_EDGE = 1568, MAX_IMAGES = 59, MAX_BYTES = 15 * 1024 * 1024, HEAD = 34, LABEL = 30;
const REFERENCES = { "hh.ru": "hh.ru", "career.habr.com": "career.habr.com", "welcometothejungle.com": "welcometothejungle.com" };

const label = () => randomBytes(3).toString("hex");
const chunk = (list, size) => list.flatMap((_, i) => i % size ? [] : [list.slice(i, i + size)]);
const svgText = (text, width, height, size, bg) => Buffer.from(
  `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="${bg}"/><text x="12" y="${Math.round(height * 0.7)}" font-family="DejaVu Sans, sans-serif" font-size="${size}" fill="#fff">${text}</text></svg>`);

async function sheet(folder, name, device, tiles) {
  const meta = await sharp(tiles[0].path).metadata();
  const [w, h] = [meta.width, meta.height];
  const horizontal = device === "mobile";
  const width = horizontal ? w * tiles.length + 12 * (tiles.length - 1) : w;
  const height = HEAD + (horizontal ? h + LABEL : (h + LABEL) * tiles.length);
  const layers = [{ input: svgText(`${folder}/${name}`, width, HEAD, 20, "#333"), left: 0, top: 0 }];
  for (const [i, tile] of tiles.entries()) {
    const left = horizontal ? i * (w + 12) : 0;
    const top = HEAD + (horizontal ? 0 : i * (h + LABEL));
    layers.push({ input: svgText(tile.id, w, LABEL, 18, "#555"), left, top });
    layers.push({ input: await sharp(tile.path).resize(w, h, { fit: "fill" }).toBuffer(), left, top: top + LABEL });
  }
  const scale = Math.min(1, LONG_EDGE / Math.max(width, height));
  const flat = await sharp({ create: { width, height, channels: 3, background: "#222" } }).composite(layers).png().toBuffer();
  await sharp(flat).resize(Math.round(width * scale), Math.round(height * scale), { kernel: "lanczos3" })
    .png({ palette: true, colours: 256, quality: 85, effort: 10, compressionLevel: 9 })
    .toFile(resolve(packDir, folder, name));
}

async function build(folder, dir) {
  mkdirSync(resolve(packDir, folder), { recursive: true });
  const ids = scenes().map(s => s.id);
  const listing = [];
  for (const [device, size, prefix] of [["desktop", 2, "d"], ["mobile", 3, "m"]]) {
    for (const [i, group] of chunk(ids, size).entries()) {
      const name = `${prefix}${String(i + 1).padStart(2, "0")}.png`;
      const tiles = group.map(id => ({ id, path: resolve(dir, device, `${id}.png`) }));
      for (const t of tiles) if (!existsSync(t.path)) throw new Error(`нет снимка ${t.path}`);
      await sheet(folder, name, device, tiles);
      listing.push({ path: `${folder}/${name}`, device, tiles: group });
    }
  }
  return listing;
}

async function reference(folder, dir) {
  mkdirSync(resolve(packDir, folder), { recursive: true });
  const listing = [];
  const pages = ["home", "search", "vacancy"];
  const groups = [["desktop", "d01.png", pages.slice(0, 2)], ["desktop", "d02.png", pages.slice(2)], ["mobile", "m01.png", pages]];
  for (const [device, name, group] of groups) {
    await sheet(folder, name, device, group.map(id => ({ id, path: resolve(dir, device, `${id}.png`) })));
    listing.push({ path: `${folder}/${name}`, device, tiles: group });
  }
  return listing;
}

function shuffle(list) {
  return list.map(v => [randomBytes(4).readUInt32LE(), v]).sort((a, b) => a[0] - b[0]).map(p => p[1]);
}

const capture = JSON.parse(readFileSync(resolve(current, "capture.json"), "utf8"));
if (capture.failed.length) throw new Error(`capture с ошибками: ${capture.failed.join("; ")}`);
if (capture.contacts?.length) throw new Error(`на снимках остались контакты: ${capture.contacts.join("; ")}`);

rmSync(packDir, { recursive: true, force: true });
mkdirSync(packDir, { recursive: true });
mkdirSync(resolve(roundDir, "scores"), { recursive: true });

const run = { round: Number(round), commit: execSync("git rev-parse HEAD", { cwd: REPO }).toString().trim(), builds: {}, references: {}, createdAt: new Date().toISOString() };
const products = [], screens = [], refs = [];
const buildLabels = shuffle([["current", current], ["base", baseDir]]);
for (const [kind, dir] of buildLabels) {
  const folder = label();
  run.builds[folder] = kind;
  products.push({ folder, title: `FastCV, build ${folder}` });
  screens.push({ folder, listing: await build(folder, dir) });
}
for (const name of shuffle(Object.keys(REFERENCES))) {
  const dir = resolve(refsDir, name);
  if (!["desktop", "mobile"].every(d => ["home", "search", "vacancy"].every(p => existsSync(resolve(dir, d, `${p}.png`)) && !isBlocked(name)))) {
    if (allowMissing) { console.log(`пропущен референс ${name}`); continue; }
    throw new Error(`нет снимков референса ${name}`);
  }
  const folder = label();
  run.references[folder] = name;
  products.push({ folder, title: REFERENCES[name] });
  refs.push({ folder, listing: await reference(folder, dir) });
}

function isBlocked(name) {
  const path = resolve(refsDir, "references.json");
  if (!existsSync(path)) return false;
  return JSON.parse(readFileSync(path, "utf8")).some(r => r.site === name && r.status >= 400);
}

const lines = entries => entries.flatMap(({ folder, listing }) => [`- \`${folder}\`:`, ...listing.map(s => `  - \`${s.path}\` (${s.device}): ${s.tiles.join(", ")}`)]).join("\n");
const axesText = Object.entries(AXES).map(([id, title]) => `- \`${id}\`: ${title}`).join("\n");
const emptyAxes = Object.fromEntries(Object.keys(AXES).map(id => [id, 0]));
const shape = {
  scores: Object.fromEntries(products.map(p => [p.folder, { desktop: emptyAxes, mobile: emptyAxes }])),
  keep: [{ product: "<folder>", screen: "<tile>", device: "desktop|mobile", what: "..." }],
  fixes: Object.fromEntries(screens.map(s => [s.folder, [{ screen: "<tile>", device: "desktop|mobile", problem: "...", change: "..." }]])),
};
const brief = readFileSync(resolve(HERE, "brief.template.md"), "utf8")
  .replace("{{PRODUCTS}}", products.map(p => `- \`${p.folder}\`: ${p.title}`).join("\n"))
  .replace("{{SCREENS}}", lines(screens))
  .replace("{{REFERENCES}}", lines(refs))
  .replace("{{FLOWS}}", Object.entries(FLOWS).map(([id, steps]) => `- ${id}: ${steps.join(" → ")}`).join("\n"))
  .replace("{{AXES}}", axesText)
  .replace("{{JSON}}", JSON.stringify(shape, null, 2));

const banned = /\b(target|round|improved|redesign|commit|baseline|previous score|earlier score)\b/i;
const hit = brief.match(banned);
if (hit) throw new Error(`запрещённое слово в брифе: ${hit[0]}`);
writeFileSync(resolve(packDir, "brief.md"), brief);
writeFileSync(resolve(roundDir, "run.json"), JSON.stringify(run, null, 2));

const images = [];
const walk = dir => { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = resolve(dir, f.name); if (f.isDirectory()) walk(p); else if (p.endsWith(".png")) images.push(p); } };
walk(packDir);
let bytes = 0;
for (const image of images) {
  const meta = await sharp(image).metadata();
  if (Math.max(meta.width, meta.height) > LONG_EDGE) throw new Error(`больше ${LONG_EDGE}px: ${image}`);
  if (/,/.test(image)) throw new Error(`запятая в пути: ${image}`);
  bytes += statSync(image).size;
}
console.log(`пакет: ${images.length} картинок, ${(bytes / 1048576).toFixed(1)} МБ`);
if (images.length > MAX_IMAGES) throw new Error(`картинок больше ${MAX_IMAGES}`);
if (bytes > MAX_BYTES) throw new Error("пакет больше 15 МБ");
