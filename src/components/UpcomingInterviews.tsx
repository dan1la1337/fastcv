"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { slotLabel, slotRange } from "@/lib/interviews";

export type Upcoming = {
  slot_id: string; conversation_id: string; application_id: string | null; i_am: string; other_name: string
  vacancy_title: string; starts_at: string; duration_min: number; place: string | null
};

/** Ближайшие собеседования работодателя — над вкладками кабинета. Пусто — ничего не показываем. */
export default function UpcomingInterviews() {
  const [list, setList] = useState<Upcoming[]>([]);

  useEffect(() => {
    let alive = true;
    supabase.rpc("my_upcoming_interviews").then(({ data }) => { if (alive) setList((data ?? []) as Upcoming[]); });
    return () => { alive = false; };
  }, []);

  if (!list.length) return null;
  return (
    <section aria-labelledby="upcoming-title" className="glass rounded-3xl p-5 space-y-3">
      <h2 id="upcoming-title" className="text-sm font-semibold text-white inline-flex items-center gap-2">
        <CalendarCheck className="w-4 h-4 text-emerald-300" aria-hidden="true" /> Ближайшие собеседования
      </h2>
      <ul className="divide-y divide-white/[0.06]">
        {list.slice(0, 8).map(x => (
          <li key={x.slot_id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <b className="text-white">{slotLabel(x.starts_at)}</b>
              <span className="text-neutral-500"> ({slotRange(x.starts_at, x.duration_min)})</span>
              <span className="text-neutral-300"> · {x.other_name} · {x.vacancy_title}</span>
            </span>
            <Link href={`/messages?c=${x.conversation_id}`} className="text-xs text-teal-300 hover:text-teal-200">Открыть чат</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
