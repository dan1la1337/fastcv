"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchSalaryBenchmarks, type SalaryBenchmark } from "@/lib/salary";
import { countryOptions as toCountryOptions, type CityRow } from "@/lib/feed-filters";
import type { SelectOption } from "@/components/SearchSelect";

/** Справочники ленты: города и страны для фильтров, вилки для оценки скрытой зарплаты. */
export function useFeedOptions() {
  // Города для фильтра — только те, где есть вакансии, по убыванию числа вакансий
  const [cities, setCities] = useState<CityRow[]>([]);
  // Страны для фильтра: Россия первой, остальные по числу вакансий
  const [countryOptions, setCountryOptions] = useState<SelectOption[]>([]);
  useEffect(() => {
    supabase.from("vacancy_cities").select("city, country, vacancies").order("vacancies", { ascending: false }).limit(300)
      .then(({ data }) => setCities(data ?? []));
    supabase.from("vacancy_countries").select("country, vacancies").order("vacancies", { ascending: false })
      .then(({ data }) => setCountryOptions(toCountryOptions(data ?? [])));
  }, []);
  // Справочник для оценки скрытой зарплаты: десятки строк, грузим один раз
  const [benchmarks, setBenchmarks] = useState<SalaryBenchmark[]>([]);
  useEffect(() => {
    fetchSalaryBenchmarks().then(setBenchmarks);
  }, []);
  return { cities, countryOptions, benchmarks };
}
