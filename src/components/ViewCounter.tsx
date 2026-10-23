"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

/** Засчитывает просмотр вакансии — один раз за сессию браузера. */
export default function ViewCounter({ vacancyId }: { vacancyId: string }) {
  useEffect(() => {
    const key = `viewed:${vacancyId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Хранилище недоступно (приватный режим) — просто считаем просмотр
    }
    void supabase.rpc("register_vacancy_view", { vacancy: vacancyId });
  }, [vacancyId]);
  return null;
}
