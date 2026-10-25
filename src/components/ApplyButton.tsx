"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Vacancy } from "@/lib/vacancies";
import SmartApply from "@/components/SmartApply";

/** Кнопка Smart Apply для страницы вакансии (сама страница рендерится на сервере). */
export default function ApplyButton({ vacancy }: { vacancy: Vacancy }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-teal-300 hover:bg-teal-200 text-neutral-950 rounded-xl text-sm font-semibold transition-colors shadow-lg shadow-teal-300/20"
      >
        <Sparkles className="w-4 h-4" /> Откликнуться с Smart Apply
      </button>
      <SmartApply vacancy={open ? vacancy : null} user={user} onClose={() => setOpen(false)} />
    </>
  );
}
