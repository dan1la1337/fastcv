"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const POLL_MS = 30_000;

/**
 * Сколько диалогов с непрочитанными сообщениями — для значков в меню. Опрашивает базу
 * раз в 30 секунд, пока вкладка открыта; обновляется сразу по событию «chat:read».
 */
export function useUnread(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      supabase.rpc("unread_conversations").then(({ data }) => { if (alive && typeof data === "number") setCount(data); });
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    window.addEventListener("chat:read", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("chat:read", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [enabled]);
  return enabled ? count : 0;
}

export function UnreadDot({ count, label = "непрочитанных", className = "" }: { count: number; label?: string; className?: string }) {
  if (!count) return null;
  return (
    <span aria-label={`${count} ${label}`}
      className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-teal-300 text-neutral-950 text-[11px] font-semibold leading-none ${className}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
