"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Vacancy } from "@/lib/vacancies";
import SmartApply from "@/components/SmartApply";

/** Панель Smart Apply справа на странице вакансии (сама страница рендерится на сервере). */
export default function VacancyApply({ vacancy }: { vacancy: Vacancy }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);
  return <SmartApply vacancy={vacancy} user={user} onClose={() => {}} inline />;
}
