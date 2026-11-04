// Сводка раунда: `node summarize.mjs <раунд> [--target 9.0]`.
// Читает scores/*.md, берёт последний блок json и пишет summary.md и summary.json.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AXES, WORK } from "./lib.mjs";

const round = process.argv[2];
if (round === undefined) throw new Error("Нужен номер раунда");
const targetAt = process.argv.indexOf("--target");
const target = targetAt > 0 ? Number(process.argv[targetAt + 1]) : null;
const dir = n => resolve(WORK, `round-${n}`);
const run = JSON.parse(readFileSync(resolve(dir(round), "run.json"), "utf8"));
const DEVICES = ["desktop", "mobile"];

function lastJson(text) {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  if (!blocks.length) return null;
  try { return JSON.parse(blocks.at(-1)[1]); } catch { return null; }
}

// Один файл — одна проверка: claude.md, claude-2.md, codex-3.md
const reviews = {};
const scoresDir = resolve(dir(round), "scores");
for (const file of readdirSync(scoresDir).filter(f => f.endsWith(".md")).sort()) {
  const reviewer = file.replace(/(-\d+)?\.md$/, "");
  const parsed = lastJson(readFileSync(resolve(scoresDir, file), "utf8"));
  (reviews[reviewer] ??= []).push({ file, parsed });
}

const named = {};
for (const [label, kind] of Object.entries(run.builds)) named[label] = kind;
for (const [label, name] of Object.entries(run.references)) named[label] = name;

// Повторы одного ревьюера сводятся к нижней оценке
function lowest(items) {
  const out = {};
  for (const { parsed } of items) {
    for (const [label, devices] of Object.entries(parsed?.scores ?? {})) {
      const name = named[label];
      if (!name) continue;
      for (const device of DEVICES) for (const axis of Object.keys(AXES)) {
        const value = devices?.[device]?.[axis];
        if (typeof value !== "number") continue;
        const slot = ((out[name] ??= {})[device] ??= {});
        slot[axis] = axis in slot ? Math.min(slot[axis], value) : value;
      }
    }
  }
  return out;
}

const summary = {};
for (const [reviewer, items] of Object.entries(reviews)) summary[reviewer] = lowest(items);
const load = n => existsSync(resolve(dir(n), "summary.json")) ? JSON.parse(readFileSync(resolve(dir(n), "summary.json"), "utf8")) : {};
const last = Number(round) > 0 ? load(Number(round) - 1) : {};
const first = load(0);

const fmt = v => v === undefined ? "no score" : Number(v).toFixed(1);
const delta = (a, b) => a === undefined || b === undefined ? "no score" : `${a - b >= 0 ? "+" : ""}${(a - b).toFixed(1)}`;
const refs = Object.values(run.references);
const out = [`# Сводка раунда ${round}`, "", `Коммит: \`${run.commit}\``, ""];
const drift = [], unmet = [];

for (const [reviewer, scores] of Object.entries(summary)) {
  const files = reviews[reviewer];
  out.push(`## ${reviewer} (${files.length}: ${files.map(f => f.file + (f.parsed ? "" : " без оценки")).join(", ")})`, "");
  out.push(`| Ось | Устройство | Сейчас | К прошлому раунду | Базовая | К базовой | ${refs.map(r => `К ${r}`).join(" | ")} |`);
  out.push(`| --- | --- | --- | --- | --- | --- | ${refs.map(() => "---").join(" | ")} |`);
  for (const axis of Object.keys(AXES)) for (const device of DEVICES) {
    const now = scores.current?.[device]?.[axis], base = scores.base?.[device]?.[axis];
    const prior = last[reviewer]?.current?.[device]?.[axis], firstBase = first[reviewer]?.base?.[device]?.[axis];
    out.push(`| ${axis} | ${device} | ${fmt(now)} | ${delta(now, prior)} | ${fmt(base)} | ${delta(now, base)} | ${refs.map(r => delta(now, scores[r]?.[device]?.[axis])).join(" | ")} |`);
    if (firstBase !== undefined && base !== undefined && Math.abs(base - firstBase) > 0.5) drift.push(`${reviewer} ${axis} ${device}: ${fmt(firstBase)} → ${fmt(base)}`);
    if (target !== null) {
      if (now === undefined || now < target) unmet.push(`${reviewer} ${axis} ${device}: ${fmt(now)} ниже ${target}`);
      for (const r of refs) {
        const value = scores[r]?.[device]?.[axis];
        if (now === undefined || value === undefined || now <= value) unmet.push(`${reviewer} ${axis} ${device}: не выше ${r} (${fmt(now)} и ${fmt(value)})`);
      }
    }
  }
  const all = DEVICES.flatMap(d => Object.values(scores.current?.[d] ?? {}));
  out.push("", `Нижняя ось: ${all.length ? fmt(Math.min(...all)) : "no score"}`, "");
}

out.push("## Дрейф базовой сборки", "", drift.length ? drift.map(d => `- ${d}`).join("\n") : "Нет: сдвиг не больше 0.5.", "");
if (target !== null) out.push(`## Цель ${target}`, "", unmet.length ? unmet.map(u => `- ${u}`).join("\n") : "Условия по этому набору оценок выполнены.", "");
out.push("## Правки ревьюеров по текущей сборке", "");
const currentLabel = Object.entries(run.builds).find(([, kind]) => kind === "current")[0];
for (const [reviewer, items] of Object.entries(reviews)) for (const { file, parsed } of items) {
  for (const fix of parsed?.fixes?.[currentLabel] ?? []) out.push(`- ${reviewer} (${file}): ${fix.screen}, ${fix.device}: ${fix.problem} → ${fix.change}`);
}
writeFileSync(resolve(dir(round), "summary.md"), out.join("\n") + "\n");
writeFileSync(resolve(dir(round), "summary.json"), JSON.stringify(summary, null, 2));
console.log(`summary.md: ${Object.keys(summary).length} ревьюера, дрейф ${drift.length}${target !== null ? `, не выполнено ${unmet.length}` : ""}`);
