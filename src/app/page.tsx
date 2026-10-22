"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchVacancyPage, formatSalary, plural, PAGE_SIZE, SPECIALTIES, VACANCY_FORMS, type Vacancy, type VacancyFilters } from "@/lib/vacancies";
import { Search, MapPin, ChevronRight, Sparkles, Loader2, ExternalLink, Globe } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import SmartApply from "@/components/SmartApply";

export default function Home() {
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<{ role?: string } | null>(null);

  // Фильтры
  const [search, setSearch] = useState("");
  const [onlyRemote, setOnlyRemote] = useState(false);
  const [minSalary, setMinSalary] = useState<number>(0);
  const [onlyWithSalary, setOnlyWithSalary] = useState<boolean>(false);
  const [city, setCity] = useState("");

  const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>(null);
  const [selectedStack, setSelectedStack] = useState<string[]>([]);

  // Вакансия, на которую сейчас откликаются (окно Smart Apply)
  const [applyVacancy, setApplyVacancy] = useState<Vacancy | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user) {
        setUser(data.user);
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", data.user.id)
          .single();
        if (profile) setUserProfile(profile);
      }
    });
  }, []);

  // Фильтры применяются в базе: так поиск идёт по всем вакансиям, а не по
  // первой тысяче, и страница грузит только PAGE_SIZE карточек за раз.
  const filters: VacancyFilters = {
    search,
    remote: onlyRemote,
    minSalary,
    withSalary: onlyWithSalary,
    city,
    // Специальность без выбранных технологий — ищем по всем её технологиям
    stack: selectedStack.length ? selectedStack : selectedSpecialty ? SPECIALTIES[selectedSpecialty] : [],
  };
  const filtersKey = JSON.stringify(filters);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    // Ждём, пока пользователь допечатает, чтобы не слать запрос на каждую букву
    const timer = setTimeout(async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const { rows, total } = await fetchVacancyPage(JSON.parse(filtersKey), 0);
        if (id !== requestId.current) return; // пришёл ответ на устаревшие фильтры
        setVacancies(rows);
        setTotal(total);
        setPage(0);
      } catch {
        if (id === requestId.current) setLoadError("Не удалось загрузить вакансии. Обновите страницу.");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [filtersKey]);

  async function loadMore() {
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const { rows, total } = await fetchVacancyPage(filters, page + 1);
      if (id !== requestId.current) return;
      setVacancies(prev => [...prev, ...rows.filter(r => !prev.some(p => p.id === r.id))]);
      setTotal(total);
      setPage(page + 1);
    } catch {
      setLoadError("Не удалось загрузить следующую страницу.");
    } finally {
      setLoadingMore(false);
    }
  }

  const toggleStack = (tech: string) => {
    setSelectedStack(prev => prev.includes(tech) ? prev.filter(t => t !== tech) : [...prev, tech]);
  };

  // Надежное определение роли: проверяем и метаданные аутентификации, и таблицу profiles
  const userRole = userProfile?.role || user?.user_metadata?.role;
  const isEmployer = userRole === 'employer';

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 antialiased font-sans relative">
      <header className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="bg-blue-600 text-white font-black px-2.5 py-1 rounded-lg text-sm tracking-tight shadow-lg shadow-blue-500/25 flex items-center gap-1">
              ⚡ Fast<span className="text-blue-200">CV</span>
            </span>
            <span className="font-semibold text-base tracking-tight text-neutral-200">AI Job Board</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-full border border-emerald-400/20">
              {loading ? "…" : `${total} ${plural(total, VACANCY_FORMS)}`}
            </span>
            
            {user ? (
              <div className="flex items-center gap-3">
                {/* Если работодатель — показываем Кабинет HR, если соискатель — Мои отклики */}
                {isEmployer ? (
                  <Link 
                    href="/employer"
                    className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium transition-colors border border-neutral-700"
                  >
                    Кабинет HR
                  </Link>
                ) : (
                  <Link 
                    href="/applications"
                    className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium transition-colors border border-neutral-700"
                  >
                    Мои отклики
                  </Link>
                )}

                <Link
                  href="/profile"
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-blue-600/20 border border-blue-500/50 text-blue-400 font-bold cursor-pointer hover:bg-blue-600/30 transition-colors relative z-50"
                  title="Перейти в личный кабинет"
                >
                  {user.email?.charAt(0).toUpperCase()}
                </Link>
              </div>
            ) : (
              <Link 
                href="/register"
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-sm font-medium transition-colors border border-neutral-700 relative z-50"
              >
                Войти / Регистрация
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-4 gap-8 relative z-0">
        {/* Sidebar Filters */}
        <aside className="lg:col-span-1 space-y-6">
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-5 space-y-6">
            {/* Поиск */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Ключевые слова</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input type="text" placeholder="Java, Backend..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-lg text-sm text-neutral-100 focus:outline-none focus:border-blue-500 transition-colors" />
              </div>
            </div>

            {/* Ползунок зарплаты и чекбокс */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Зарплата от</label>
                <span className="text-xs font-semibold text-emerald-400 transition-all duration-200">
                  {minSalary === 0 ? "Любая" : `${minSalary.toLocaleString("ru-RU")} ₽`}
                </span>
              </div>

              <div className="space-y-2">
                <input
                  type="range"
                  min={0}
                  max={500000}
                  step={25000}
                  value={minSalary}
                  onChange={(e) => setMinSalary(Number(e.target.value))}
                  className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-blue-500 transition-all hover:bg-neutral-700"
                />
                <div className="flex justify-between text-[10px] text-neutral-500 font-mono">
                  <span>0 ₽</span>
                  <span>250k</span>
                  <span>500k+</span>
                </div>
              </div>

              <label 
                onClick={() => setOnlyWithSalary(!onlyWithSalary)}
                className="flex items-center gap-3 cursor-pointer group pt-1 select-none"
              >
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all duration-150 ${onlyWithSalary ? 'bg-blue-600 border-blue-500' : 'border-neutral-700 group-hover:border-neutral-500'}`}>
                  {onlyWithSalary && <span className="text-white text-[10px] font-bold">✓</span>}
                </div>
                <span className="text-xs text-neutral-300 group-hover:text-neutral-100 transition-colors">
                  Только с указанной ЗП
                </span>
              </label>
            </div>

            {/* Удаленка */}
            <div className="space-y-3 pt-2 border-t border-neutral-800/60">
              <label 
                onClick={() => setOnlyRemote(!onlyRemote)}
                className="flex items-center gap-3 cursor-pointer group select-none"
              >
                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${onlyRemote ? 'bg-blue-600 border-blue-500' : 'border-neutral-700 group-hover:border-neutral-500'}`}>
                  {onlyRemote && <span className="text-white text-xs font-bold">✓</span>}
                </div>
                <span className="text-sm text-neutral-300 group-hover:text-neutral-100 transition-colors">
                  Только удалёнка
                </span>
              </label>
            </div>

            {/* Город */}
            <div className="space-y-3 pt-2 border-t border-neutral-800/60">
              <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Город</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input type="text" placeholder="Москва, Алматы..." value={city} onChange={(e) => setCity(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-lg text-sm text-neutral-100 focus:outline-none focus:border-blue-500 transition-colors" />
              </div>
            </div>
          </div>

          {/* Многоуровневый фильтр стека */}
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-5 space-y-4">
             <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Направление</label>
             
             <div className="space-y-1.5 pt-1">
               {Object.keys(SPECIALTIES).map(spec => (
                 <button 
                    key={spec}
                    onClick={() => { setSelectedSpecialty(selectedSpecialty === spec ? null : spec); setSelectedStack([]); }}
                    className={`w-full flex items-center justify-between text-sm px-3 py-2 rounded-md transition-colors ${selectedSpecialty === spec ? 'bg-blue-600/10 text-blue-400 font-medium' : 'text-neutral-300 hover:bg-neutral-800/50'}`}
                 >
                   {spec}
                   {selectedSpecialty === spec && <ChevronRight className="w-4 h-4" />}
                 </button>
               ))}
             </div>

             {selectedSpecialty && (
               <div className="pt-4 border-t border-neutral-800 animate-in fade-in slide-in-from-top-2">
                 <p className="text-xs text-neutral-500 mb-3">Уточнить по технологиям (можно несколько):</p>
                 <div className="flex flex-wrap gap-2">
                   {SPECIALTIES[selectedSpecialty].slice(1).map(tech => (
                     <button
                        key={tech}
                        onClick={() => toggleStack(tech)}
                        className={`text-xs px-2.5 py-1.5 rounded border transition-all ${selectedStack.includes(tech) ? 'bg-blue-600 border-blue-500 text-white' : 'bg-neutral-950 border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'}`}
                     >
                       {tech}
                     </button>
                   ))}
                 </div>
               </div>
             )}
          </div>
        </aside>

        {/* Vacancies Feed */}
        <section className="lg:col-span-3">
          {loading ? (
            <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div>
          ) : loadError ? (
            <div className="text-center py-20 text-sm text-red-400">{loadError}</div>
          ) : vacancies.length === 0 ? (
            <div className="text-center py-20 bg-neutral-900/30 border border-dashed border-neutral-800 rounded-2xl">
              <p className="text-neutral-300 text-sm font-medium">Ничего не нашлось</p>
              <p className="text-neutral-500 text-xs mt-1">Попробуйте ослабить фильтры</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {vacancies.map((item) => (
                <div key={item.id} className="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden group">
                  
                  {/* Бейджи источников */}
                  {item.source_type === 'external' ? (
                     <div className="absolute top-0 right-0 bg-blue-500/10 text-blue-400 text-[10px] uppercase font-bold px-3 py-1 rounded-bl-lg border-b border-l border-blue-500/20 z-10">
                       Telegram
                     </div>
                  ) : (
                     <div className="absolute top-0 right-0 bg-emerald-500/10 text-emerald-400 text-[10px] uppercase font-bold px-3 py-1 rounded-bl-lg border-b border-l border-emerald-500/20 z-10 flex items-center gap-1">
                       <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                       Прямой работодатель
                     </div>
                  )}

                  <div className="flex flex-col sm:flex-row justify-between gap-4">
                    <div className="pr-12">
                      <h2 className="text-xl font-bold text-neutral-100">
                        <Link href={`/vacancy/${item.id}`} className="hover:text-blue-400 transition-colors">{item.title}</Link>
                      </h2>
                      <p className="text-base font-semibold text-emerald-400 mt-1">{formatSalary(item.salary_min, item.salary_max, item.salary_currency)}</p>
                      {(item.city || item.is_remote) && (
                        <p className="flex flex-wrap items-center gap-3 text-xs text-neutral-400 mt-2">
                          {item.city && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{item.city}</span>}
                          {item.is_remote && <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" />Удалённо</span>}
                        </p>
                      )}
                    </div>
                    
                    <button
                      onClick={() => setApplyVacancy(item)}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition-colors shrink-0 shadow-lg shadow-blue-500/20 relative z-10"
                    >
                      <Sparkles className="w-4 h-4" /> Smart Apply
                    </button>
                  </div>
                  <p className="text-sm text-neutral-400 leading-relaxed line-clamp-3">{item.description}</p>

                  {(item.stack?.length || item.source_url) ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {item.stack?.slice(0, 8).map(tech => (
                        <span key={tech} className="text-[11px] px-2 py-0.5 rounded-md bg-neutral-800/80 border border-neutral-700/60 text-neutral-300">
                          {tech}
                        </span>
                      ))}
                      {item.source_url && (
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-blue-400 transition-colors"
                        >
                          Пост в Telegram <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ) : null}
                </div>
              ))}

              {vacancies.length < total && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="mx-auto mt-2 inline-flex items-center gap-2 px-6 py-2.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl text-sm text-neutral-200 transition-colors disabled:opacity-50"
                >
                  {loadingMore
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Загружаем…</>
                    : `Показать ещё (${Math.min(PAGE_SIZE, total - vacancies.length)} из ${total - vacancies.length})`}
                </button>
              )}
            </div>
          )}
        </section>
      </main>

      <SmartApply vacancy={applyVacancy} user={user} onClose={() => setApplyVacancy(null)} />
    </div>
  );
}