"use client";

import { useEffect, useRef, useState } from "react";
import { agoLabel, type LiveStats } from "@/lib/live";
import { plural } from "@/lib/vacancies";

const POLL_MS = 60_000;
const fmt = (n: number) => n.toLocaleString("ru-RU");

/** Плавно докручивает число до нового значения (без анимации, если пользователь просил). */
function useTween(target: number, ms = 900) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      setValue(target);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setValue(Math.round(start + (target - start) * eased));
      if (k < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

/**
 * Живой счётчик «Авроры»: сколько вакансий сейчас, сколько новых за сутки и когда пришла
 * последняя. Опрашивает /api/live-stats раз в минуту (там кэш на минуту), только пока вкладка видна.
 */
export default function LiveCounter({ initial }: { initial: LiveStats }) {
  const [stats, setStats] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const total = useTween(stats.total);

  useEffect(() => {
    let stopped = false;
    async function refresh() {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/live-stats", { cache: "no-store" });
        if (response.ok && !stopped) setStats(await response.json());
      } catch {
        // сеть пропала — покажем прежние цифры, следующий опрос попробует снова
      }
      if (!stopped) setNow(Date.now());
    }
    const poll = setInterval(refresh, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return (
    <div data-live-stats className="rounded-3xl border border-white/10 bg-white/[0.04] px-6 py-6 sm:px-8 flex flex-wrap items-center gap-x-12 gap-y-6">
      <div className="space-y-1.5">
        <p className="flex items-center gap-2.5 font-mono text-xs text-teal-300" suppressHydrationWarning>
          <span className="relative h-2 w-2" aria-hidden="true">
            <span className="live-ping absolute inset-0 rounded-full bg-teal-300" />
            <span className="absolute inset-0 rounded-full bg-teal-300" />
          </span>
          LIVE{stats.last_at && <> · новая вакансия {agoLabel(stats.last_at, now)}</>}
        </p>
        <p className="flex items-baseline gap-3">
          <span className="font-display text-4xl sm:text-5xl font-bold tabular-nums tracking-tight" aria-live="polite">{fmt(total)}</span>
          <span className="text-neutral-400">{plural(stats.total, ["вакансия", "вакансии", "вакансий"])} сейчас</span>
        </p>
      </div>
      <div className="hidden sm:block h-16 w-px bg-white/10" aria-hidden="true" />
      <dl className="flex flex-wrap gap-x-10 gap-y-4">
        <div>
          <dt className="sr-only">Новых за сутки</dt>
          <dd className="font-display text-2xl sm:text-3xl font-bold text-teal-300 tabular-nums">+{fmt(stats.new_24h)}</dd>
          <dd className="text-sm text-neutral-400 mt-1">новых за сутки</dd>
        </div>
        <div>
          <dt className="sr-only">Telegram-каналов</dt>
          <dd className="font-display text-2xl sm:text-3xl font-bold tabular-nums">{fmt(stats.channels)}</dd>
          <dd className="text-sm text-neutral-400 mt-1">{plural(stats.channels, ["Telegram-канал", "Telegram-канала", "Telegram-каналов"])}</dd>
        </div>
        <div>
          <dt className="sr-only">Сайтов компаний</dt>
          <dd className="font-display text-2xl sm:text-3xl font-bold tabular-nums">{fmt(stats.companies)}</dd>
          <dd className="text-sm text-neutral-400 mt-1">{plural(stats.companies, ["сайт компании", "сайта компаний", "сайтов компаний"])}</dd>
        </div>
      </dl>
    </div>
  );
}
