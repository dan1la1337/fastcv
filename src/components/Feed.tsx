"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  AREAS, DEFAULT_FILTERS, DIRECTIONS, experienceLabel, sourceOf, freshnessLabel, LEVELS, WORK_FORMATS, fetchVacancyPage, formatLabel, formatSalary, levelLabel, plural, PAGE_SIZE,
  VACANCY_FORMS, SOURCES, type SourceKind, type Area, type Level, type Vacancy, type VacancyFilters, type WorkFormat,
} from "@/lib/vacancies";
import { Clock, Search, MapPin, ChevronDown, Sparkles, Loader2, ExternalLink, Globe, SlidersHorizontal, Briefcase, Building2, Target, Bookmark, BookmarkCheck, EyeOff, Undo2 } from "lucide-react";
import { fetchMarked, fetchMarks, setMark, type MarkKind } from "@/lib/marks";
import { toast } from "@/components/Toaster";
import { fetchMatches, fetchRecommended, type Match } from "@/lib/matching";
import type { Tables } from "@/lib/database.types";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import Logo from "@/components/Logo";
import MatchRing from "@/components/MatchRing";
import SmartApply from "@/components/SmartApply";
import CompanyLine from "@/components/CompanyLine";
import { estimateSalary, fetchSalaryBenchmarks, type SalaryBenchmark } from "@/lib/salary";
import SalaryEstimate from "@/components/SalaryEstimate";
import SearchSelect, { type SelectOption } from "@/components/SearchSelect";

/**
 * Лента вакансий с фильтрами. Первую страницу без фильтров сервер отдаёт сразу
 * в HTML (initialRows): лента видна до загрузки скриптов и индексируется поисковиками.
 * Дальше — запросы из браузера при смене фильтров и «Показать ещё».
 */
export default function Feed({ initialRows, initialTotal, hero }: { initialRows: Vacancy[] | null; initialTotal: number; hero?: React.ReactNode }) {
  const [vacancies, setVacancies] = useState<Vacancy[]>(initialRows ?? []);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(initialRows === null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<Tables<"profiles"> | null>(null);

  // «Для вас»: подборка по профилю кандидата и процент совпадения на карточках
  const [mode, setMode] = useState<"all" | "for-you" | "saved">("all");

  // Избранное и скрытые: отметки пользователя на вакансиях
  const [marks, setMarks] = useState<Map<string, MarkKind>>(new Map());
  // Вакансии, отметка которых ещё сохраняется: второй клик до ответа базы мог обогнать первый
  const [pendingMarks, setPendingMarks] = useState<Set<string>>(new Set());
  const hiddenRef = useRef<string[]>([]);
  const [savedList, setSavedList] = useState<Vacancy[]>([]);
  const [hiddenList, setHiddenList] = useState<Vacancy[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [matches, setMatches] = useState<Record<string, Match>>({});
  // Города для фильтра — только те, где есть вакансии, по убыванию числа вакансий
  const [cityOptions, setCityOptions] = useState<SelectOption[]>([]);
  useEffect(() => {
    supabase.from("vacancy_cities").select("city, vacancies").order("vacancies", { ascending: false }).limit(300)
      .then(({ data }) => setCityOptions((data ?? []).map(c => ({ value: c.city, label: c.city, count: c.vacancies }))));
  }, []);
  // Справочник для оценки скрытой зарплаты: десятки строк, грузим один раз
  const [benchmarks, setBenchmarks] = useState<SalaryBenchmark[]>([]);
  useEffect(() => {
    fetchSalaryBenchmarks().then(setBenchmarks);
  }, []);
  const requestedMatches = useRef(new Set<string>());
  const [recommended, setRecommended] = useState<Vacancy[]>([]);
  const [recPage, setRecPage] = useState(0);
  const [recHasMore, setRecHasMore] = useState(false);
  const [recLoading, setRecLoading] = useState(false);

  // Фильтры
  const [search, setSearch] = useState("");
  const [formats, setFormats] = useState<WorkFormat[]>([]);
  const [sources, setSources] = useState<SourceKind[]>([]);
  const [minSalary, setMinSalary] = useState<number>(0);
  const [onlyWithSalary, setOnlyWithSalary] = useState<boolean>(false);
  const [city, setCity] = useState("");

  const [selectedDirection, setSelectedDirection] = useState<string | null>(null);
  const [area, setArea] = useState<Area | "">("");
  const [selectedLevels, setSelectedLevels] = useState<Level[]>([]);
  const [selectedStack, setSelectedStack] = useState<string[]>([]);
  // На телефоне фильтры свёрнуты, иначе они занимают весь первый экран
  const [filtersOpen, setFiltersOpen] = useState(false);

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
        // Ссылка «/?tab=for-you» (после онбординга) сразу открывает подборку
        const tab = new URLSearchParams(window.location.search).get("tab");
        if (profile?.role === "candidate" && tab === "for-you") {
          setMode("for-you");
          void loadRecommended(0);
        }
        // «/?tab=saved» — нижняя панель на телефоне ведёт сразу в избранное
        if (profile?.role === "candidate" && tab === "saved") void showSaved();
      }
    });
  }, []);

  // Фильтры применяются в базе: так поиск идёт по всем вакансиям, а не по
  // первой тысяче, и страница грузит только PAGE_SIZE карточек за раз.
  const filters: VacancyFilters = {
    search,
    formats,
    minSalary,
    withSalary: onlyWithSalary,
    city,
    direction: selectedDirection ?? "",
    area,
    levels: selectedLevels,
    stack: selectedStack,
    sources,
  };
  const filtersKey = JSON.stringify(filters);
  const requestId = useRef(0);
  // Данные для фильтров по умолчанию уже пришли с сервера — первый запрос не нужен
  const serverDataFor = useRef<string | null>(initialRows ? JSON.stringify(DEFAULT_FILTERS) : null);

  useEffect(() => {
    if (serverDataFor.current === filtersKey) {
      serverDataFor.current = null;
      return;
    }
    serverDataFor.current = null;
    // Фильтры относятся к общей ленте: тронули фильтр — показываем её
    setMode("all");
    const id = ++requestId.current;
    // Ждём, пока пользователь допечатает, чтобы не слать запрос на каждую букву
    const timer = setTimeout(async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const { rows, total } = await fetchVacancyPage(JSON.parse(filtersKey), 0, hiddenRef.current);
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

  /** Раздел ленты; направление из другого раздела сбрасываем, иначе лента окажется пустой. */
  function chooseArea(next: Area | "") {
    setArea(next);
    if (next && selectedDirection && DIRECTIONS.find(d => d.id === selectedDirection)?.group !== next) {
      setSelectedDirection(null);
      setSelectedStack([]);
    }
  }

  async function loadMore() {
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const { rows, total } = await fetchVacancyPage(filters, page + 1, hiddenRef.current);
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

  // Надежное определение роли: проверяем и метаданные аутентификации, и таблицу profiles
  const userRole = userProfile?.role || user?.user_metadata?.role;
  const isEmployer = userRole === 'employer';
  const isCandidate = Boolean(user) && userProfile?.role === "candidate";
  const profileSkills = Array.isArray(userProfile?.skills) ? userProfile.skills : [];
  const hasPrefs = Boolean(userProfile?.pref_directions?.length || profileSkills.length || userProfile?.pref_level);

  // Процент совпадения для карточек общей ленты (подборка приходит уже с ним)
  useEffect(() => {
    if (!isCandidate || !hasPrefs) return;
    const ids = vacancies.map(v => v.id).filter(id => !requestedMatches.current.has(id));
    if (!ids.length) return;
    ids.forEach(id => requestedMatches.current.add(id));
    fetchMatches(ids).then(found => setMatches(prev => ({ ...prev, ...found }))).catch(() => {
      ids.forEach(id => requestedMatches.current.delete(id));
    });
  }, [isCandidate, hasPrefs, vacancies]);

  // «У меня есть этот опыт»: навык из «Не хватает» одним нажатием попадает в профиль,
  // совпадение пересчитывается, а письмо Smart Apply берёт навыки из профиля
  const [addingSkill, setAddingSkill] = useState<string | null>(null);
  async function addSkill(skill: string) {
    if (!user || !userProfile || addingSkill) return;
    const next = [...new Set([...profileSkills, skill])].slice(0, 50);
    setAddingSkill(skill);
    const { error } = await supabase.from("profiles").update({ skills: next }).eq("id", user.id);
    setAddingSkill(null);
    if (error) {
      toast("Не удалось обновить профиль. Попробуйте ещё раз.", "error");
      return;
    }
    setUserProfile({ ...userProfile, skills: next });
    const ids = vacancies.map(v => v.id);
    try {
      const found = await fetchMatches(ids);
      setMatches(prev => ({ ...prev, ...found }));
    } catch {
      // старые проценты останутся до следующей загрузки
    }
    toast(`«${skill}» добавлен в профиль — совпадение пересчитано.`, "ok");
  }

  // Отметки загружаем один раз после входа; дальше меняем локально вместе с базой
  useEffect(() => {
    if (!isCandidate) return;
    fetchMarks().then(found => {
      setMarks(found);
      hiddenRef.current = [...found].filter(([, kind]) => kind === "hidden").map(([id]) => id);
    }).catch(() => {});
  }, [isCandidate]);

  async function toggleMark(item: Vacancy, kind: MarkKind) {
    if (!user || pendingMarks.has(item.id)) return;
    setPendingMarks(prev => new Set(prev).add(item.id));
    const next = marks.get(item.id) === kind ? null : kind;
    const before = marks;
    const updated = new Map(marks);
    if (next) updated.set(item.id, next); else updated.delete(item.id);
    setMarks(updated);
    hiddenRef.current = [...updated].filter(([, k]) => k === "hidden").map(([id]) => id);
    if (next === "saved") setSavedList(prev => [item, ...prev.filter(v => v.id !== item.id)]);
    if (next !== "saved") setSavedList(prev => prev.filter(v => v.id !== item.id));
    if (next === "hidden") setHiddenList(prev => [item, ...prev.filter(v => v.id !== item.id)]);
    if (next !== "hidden") setHiddenList(prev => prev.filter(v => v.id !== item.id));
    try {
      await setMark(user.id, item.id, next);
      if (next === "hidden") toast("Вакансия скрыта. Вернуть можно во вкладке «Избранное».", "info");
      if (next === "saved") toast("Добавлено в избранное.", "ok");
    } catch {
      setMarks(before);
      hiddenRef.current = [...before].filter(([, k]) => k === "hidden").map(([id]) => id);
      toast("Не удалось сохранить отметку. Попробуйте ещё раз.", "error");
    } finally {
      setPendingMarks(prev => { const rest = new Set(prev); rest.delete(item.id); return rest; });
    }
  }

  async function showSaved() {
    setMode("saved");
    setSavedLoading(true);
    setLoadError(null);
    try {
      const [saved, hidden] = await Promise.all([fetchMarked("saved"), fetchMarked("hidden")]);
      setSavedList(saved);
      setHiddenList(hidden);
    } catch {
      setLoadError("Не удалось загрузить избранное. Обновите страницу.");
    } finally {
      setSavedLoading(false);
    }
  }

  async function loadRecommended(nextPage: number) {
    setRecLoading(true);
    setLoadError(null);
    try {
      const { rows, matches: found, hasMore } = await fetchRecommended(nextPage, PAGE_SIZE);
      setRecommended(prev => nextPage === 0 ? rows : [...prev, ...rows.filter(r => !prev.some(p => p.id === r.id))]);
      setMatches(prev => ({ ...prev, ...found }));
      setRecPage(nextPage);
      setRecHasMore(hasMore);
    } catch {
      setLoadError("Не удалось собрать подборку. Обновите страницу.");
    } finally {
      setRecLoading(false);
    }
  }

  function showForYou() {
    setMode("for-you");
    void loadRecommended(0);
  }

  const toggleStack = (tech: string) => {
    setSelectedStack(prev => prev.includes(tech) ? prev.filter(t => t !== tech) : [...prev, tech]);
  };
  const toggleLevel = (level: Level) => {
    setSelectedLevels(prev => prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]);
  };
  const direction = DIRECTIONS.find(d => d.id === selectedDirection);
  const chip = (active: boolean) =>
    `text-xs px-3 py-1.5 rounded-full border transition-colors ${active
      ? "bg-teal-300/15 border-teal-300 text-teal-200"
      : "bg-transparent border-white/15 text-neutral-300 hover:border-white/30 hover:text-neutral-100"}`;

  const forYou = mode === "for-you";
  const savedMode = mode === "saved";
  const notHidden = (v: Vacancy) => marks.get(v.id) !== "hidden";
  const list = savedMode ? savedList : (forYou ? recommended : vacancies).filter(notHidden);
  const listLoading = savedMode ? savedLoading : forYou ? recLoading && recommended.length === 0 : loading;

  const card = (item: Vacancy) => {
    // Без заполненного профиля оценка у всех одинаковая — не показываем её
    const match = hasPrefs ? matches[item.id] : undefined;
    return (
      <div key={item.id} className="bg-white/[0.04] border border-white/10 hover:border-white/20 rounded-3xl p-5 sm:p-6 flex flex-col gap-4 relative overflow-hidden group transition-colors">

        {/* Бейджи источников */}
        {item.source_type === 'external' ? (
           <div className="absolute top-4 right-4 bg-white/[0.06] text-neutral-300 text-[11px] font-medium px-2.5 py-1 rounded-full z-10">
             {sourceOf(item).badge}
           </div>
        ) : (
           <div className="absolute top-4 right-4 bg-teal-300/15 text-teal-200 text-[11px] font-medium px-2.5 py-1 rounded-full z-10 flex items-center gap-1.5">
             <span className="w-1.5 h-1.5 rounded-full bg-teal-300 animate-pulse"></span>
             Прямой работодатель
           </div>
        )}

        <div className="flex flex-col sm:flex-row justify-between gap-4">
          <div className="flex gap-4 sm:gap-5 items-start pr-24 sm:pr-28">
          {match && <MatchRing value={match.score} size={64} stroke={match.score >= 70 ? "#5EEAD4" : "#818CF8"} />}
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-semibold text-neutral-100 leading-snug">
              <Link href={`/vacancy/${item.id}`} className="hover:text-teal-300 transition-colors">{item.title}</Link>
            </h2>
            <CompanyLine vacancy={item} className="text-sm text-neutral-400 mt-0.5" />
            <p className="text-base font-semibold text-neutral-100 mt-1.5 flex flex-wrap items-center gap-2">
              {formatSalary(item.salary_min, item.salary_max, item.salary_currency)}
              {(() => {
                const estimate = estimateSalary(item, benchmarks);
                return estimate && <SalaryEstimate estimate={estimate} className="text-xs" />;
              })()}
            </p>
            <p className="flex flex-wrap items-center gap-3 text-xs text-neutral-400 mt-2">
              {(item.level || item.experience_min != null) && (
              <span className="inline-flex items-center gap-1"><Briefcase className="w-3.5 h-3.5" />
                {[item.level && levelLabel(item.level), experienceLabel(item.experience_min)].filter(Boolean).join(" · ")}
              </span>
            )}
              {item.city && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{item.city}</span>}
              {item.work_format === "remote" || (!item.work_format && item.is_remote)
                ? <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" />Удалённо</span>
                : item.work_format && <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{formatLabel(item.work_format)}</span>}
              <span className="inline-flex items-center gap-1" title="Когда вакансию впервые опубликовали и во скольких каналах" suppressHydrationWarning>
                <Clock className="w-3.5 h-3.5" />{freshnessLabel(item)}
              </span>
            </p>
          </div>
          </div>

          <button
            onClick={() => setApplyVacancy(item)}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-teal-300 hover:bg-teal-200 text-neutral-950 rounded-full text-sm font-semibold transition-colors shrink-0 relative z-10 sm:self-end"
          >
            <Sparkles className="w-4 h-4" /> Smart Apply
          </button>
        </div>
        <p className="text-sm text-neutral-400 leading-relaxed line-clamp-3">{item.description}</p>

        {match && (match.matched.length > 0 || match.missing.length > 0 || match.related.length > 0) && (
          <p className="text-xs text-neutral-500">
            {match.matched.length > 0 && <>Есть у вас: <span className="text-teal-200">{match.matched.join(", ")}</span></>}
            {match.related.length > 0 && (
              <>
                {match.matched.length > 0 && " · "}
                Близко:{" "}
                <span className="text-sky-300" title="Засчитано наполовину: у вас есть смежный опыт">
                  {match.related.map(r => `${r.skill} (у вас ${r.via})`).join(", ")}
                </span>
              </>
            )}
            {(match.matched.length > 0 || match.related.length > 0) && match.missing.length > 0 && " · "}
            {match.missing.length > 0 && (
              <>
                Не хватает:{" "}
                {match.missing.map((skill, i) => (
                  <span key={skill}>
                    {i > 0 && ", "}
                    <button
                      onClick={() => addSkill(skill)}
                      disabled={addingSkill !== null}
                      title="У меня есть этот опыт — добавить в профиль"
                      aria-label={`У меня есть опыт с ${skill} — добавить в профиль`}
                      className="text-amber-300 underline decoration-dotted underline-offset-2 hover:text-amber-200 disabled:opacity-60"
                    >
                      {addingSkill === skill ? "добавляем…" : `+ ${skill}`}
                    </button>
                  </span>
                ))}
                <span className="text-neutral-600"> — нажмите на навык, если он у вас есть</span>
              </>
            )}
          </p>
        )}

        {(item.stack?.length || item.source_url || isCandidate) ? (
          <div className="flex flex-wrap items-center gap-2">
            {item.stack?.slice(0, 8).map(tech => (
              <span key={tech} className="text-[11px] px-2.5 py-0.5 rounded-full bg-white/[0.06] text-neutral-300">
                {tech}
              </span>
            ))}
            <span className="ml-auto inline-flex items-center gap-3">
              {isCandidate && (
                <>
                  <button
                    onClick={() => toggleMark(item, "saved")}
                    disabled={pendingMarks.has(item.id)}
                    aria-pressed={marks.get(item.id) === "saved"}
                    className={`inline-flex items-center gap-1 text-xs transition-colors ${marks.get(item.id) === "saved" ? "text-amber-300" : "text-neutral-500 hover:text-amber-300"}`}
                  >
                    {marks.get(item.id) === "saved" ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
                    {marks.get(item.id) === "saved" ? "В избранном" : "В избранное"}
                  </button>
                  {!savedMode && (
                    <button
                      onClick={() => toggleMark(item, "hidden")}
                      disabled={pendingMarks.has(item.id)}
                      className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                    >
                      <EyeOff className="w-3.5 h-3.5" /> Скрыть
                    </button>
                  )}
                </>
              )}
              {item.source_url && (
                <a
                  href={item.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-teal-300 transition-colors"
                >
                  {sourceOf(item).link} <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </span>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="min-h-screen text-neutral-100 antialiased font-sans relative">
      <header className="border-b border-white/10 bg-neutral-950/70 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo />
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="inline-flex items-center gap-2 font-mono text-[11px] sm:text-xs text-teal-300 whitespace-nowrap">
              <span className="relative h-2 w-2" aria-hidden="true">
                <span className="live-ping absolute inset-0 rounded-full bg-teal-300" />
                <span className="absolute inset-0 rounded-full bg-teal-300" />
              </span>
              {loading ? "…" : `${total.toLocaleString("ru-RU")} ${plural(total, VACANCY_FORMS)}`}
            </span>
            
            {user ? (
              <div className="flex items-center gap-3">
                {/* Если работодатель — показываем Кабинет HR, если соискатель — Мои отклики */}
                {isEmployer ? (
                  <Link 
                    href="/employer"
                    className="px-4 py-2 rounded-full text-sm text-neutral-300 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    Кабинет HR
                  </Link>
                ) : (
                  <Link 
                    href="/applications"
                    className="px-4 py-2 rounded-full text-sm text-neutral-300 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    Мои отклики
                  </Link>
                )}

                <Link
                  href="/profile"
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-neutral-100 font-semibold cursor-pointer hover:bg-white/15 transition-colors relative z-50"
                  title="Перейти в личный кабинет"
                >
                  {user.email?.charAt(0).toUpperCase()}
                </Link>
              </div>
            ) : (
              <Link 
                href="/register"
                className="px-4 py-2 bg-white/[0.08] hover:bg-white/[0.14] text-neutral-100 rounded-full text-sm font-medium transition-colors border border-white/15 relative z-50 whitespace-nowrap"
              >
                Войти<span className="hidden sm:inline"> / Регистрация</span>
              </Link>
            )}
          </div>
        </div>
      </header>

      {hero}
      <main id="feed" className="max-w-6xl mx-auto px-4 py-6 lg:py-8 grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-8 relative z-0 scroll-mt-20">
        {(() => {
          const active = [search.trim(), formats.length > 0, minSalary > 0, onlyWithSalary, city.trim(), selectedDirection, area, selectedLevels.length > 0, sources.length > 0].filter(Boolean).length;
          return (
            <button
              onClick={() => setFiltersOpen(open => !open)}
              aria-expanded={filtersOpen}
              className="lg:hidden flex items-center justify-between w-full px-5 py-3 bg-white/[0.04] border border-white/10 rounded-full text-sm font-medium text-neutral-200"
            >
              <span className="inline-flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-neutral-400" /> Фильтры
                {active > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-teal-300 text-neutral-950">{active}</span>}
              </span>
              <ChevronDown className={`w-4 h-4 text-neutral-400 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
            </button>
          );
        })()}
        {/* Sidebar Filters */}
        <aside className={`lg:col-span-1 space-y-6 ${filtersOpen ? "" : "hidden"} lg:block`}>
          <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-6">
            {/* Поиск */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Ключевые слова</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input type="text" placeholder="Java, Backend..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-white/[0.04] border border-white/10 rounded-full text-sm text-neutral-100 focus:outline-none focus:border-teal-300 transition-colors" />
              </div>
            </div>

            {/* Ползунок зарплаты и чекбокс */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Зарплата от</label>
                <span className="text-xs font-semibold text-teal-200 transition-all duration-200">
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
                  className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-teal-300 transition-all hover:bg-neutral-700"
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
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all duration-150 ${onlyWithSalary ? 'bg-teal-300 border-teal-300' : 'border-neutral-700 group-hover:border-neutral-500'}`}>
                  {onlyWithSalary && <span className="text-neutral-950 text-[10px] font-bold">✓</span>}
                </div>
                <span className="text-xs text-neutral-300 group-hover:text-neutral-100 transition-colors">
                  Только с указанной ЗП
                </span>
              </label>
            </div>

            {/* Формат работы */}
            <div className="space-y-3 pt-2 border-t border-white/[0.08]">
              <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Формат</label>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setFormats([])} className={chip(formats.length === 0)} aria-pressed={formats.length === 0}>Любой</button>
                {WORK_FORMATS.map(f => (
                  <button key={f.id}
                    onClick={() => setFormats(prev => prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id])}
                    className={chip(formats.includes(f.id))} aria-pressed={formats.includes(f.id)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Источник */}
            <div className="space-y-3 pt-2 border-t border-white/[0.08]">
              <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Источник</label>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setSources([])} className={chip(sources.length === 0)} aria-pressed={sources.length === 0}>Все</button>
                {SOURCES.map(s => (
                  <button key={s.id}
                    onClick={() => setSources(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                    className={chip(sources.includes(s.id))} aria-pressed={sources.includes(s.id)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Уровень */}
            <div className="space-y-3 pt-2 border-t border-white/[0.08]">
              <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Уровень</label>
              <div className="flex flex-wrap gap-2">
                {LEVELS.map(l => (
                  <button key={l.id} onClick={() => toggleLevel(l.id)} className={chip(selectedLevels.includes(l.id))} aria-pressed={selectedLevels.includes(l.id)}>
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Город */}
            <div className="space-y-3 pt-2 border-t border-white/[0.08]">
              <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Город</label>
              <SearchSelect label="Город" placeholder="Начните вводить город…" emptyLabel="Любой город"
                options={cityOptions} value={city} onChange={setCity} />
            </div>
          </div>

          {/* Направление и уточнение по технологиям */}
          <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-4">
            <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Направление</label>

            <SearchSelect label="Направление" placeholder="Например: frontend, маркетинг, React…" emptyLabel="Все направления"
              options={AREAS.filter(a => !area || a.id === area).flatMap(a => DIRECTIONS.filter(d => d.group === a.id).map(d => ({
                value: d.id, label: d.label, group: a.label, keywords: d.tech,
              })))}
              value={selectedDirection ?? ""}
              onChange={v => { setSelectedDirection(v || null); setSelectedStack([]); }} />

            {direction?.tech && (
              <div className="pt-4 border-t border-neutral-800">
                <p className="text-xs text-neutral-500 mb-3">Уточнить по технологиям (можно несколько):</p>
                <div className="flex flex-wrap gap-2">
                  {direction.tech.map(tech => (
                    <button key={tech} onClick={() => toggleStack(tech)} className={chip(selectedStack.includes(tech))} aria-pressed={selectedStack.includes(tech)}>
                      {tech}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Vacancies Feed */}
        <section className="lg:col-span-3 space-y-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Раздел ленты">
            {([["", "Все разделы", "Все"], ...AREAS.map(a => [a.id, a.label, a.short])] as [Area | "", string, string][]).map(([id, label, short]) => (
              <button
                key={id || "all"}
                onClick={() => chooseArea(id)}
                aria-pressed={area === id}
                className={`px-4 py-2 rounded-full text-sm border transition-colors ${
                  area === id ? "bg-teal-300 border-teal-300 text-neutral-950 font-medium" : "bg-white/[0.04] border-white/10 text-neutral-300 hover:bg-white/[0.08]"
                }`}
              >
                <span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
          {isCandidate && (
            <div className="flex items-center gap-2" role="tablist" aria-label="Какие вакансии показать">
              {([["all", "Все вакансии"], ["for-you", "Для вас"], ["saved", "Избранное"]] as const).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={mode === id}
                  onClick={() => (id === "for-you" ? showForYou() : id === "saved" ? showSaved() : setMode("all"))}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                    mode === id ? "bg-white/[0.14] border-white/20 text-neutral-100" : "bg-transparent border-white/10 text-neutral-400 hover:text-neutral-100"
                  }`}
                >
                  {id === "for-you" && <Target className="w-4 h-4" />}
                  {id === "saved" && <Bookmark className="w-4 h-4" />}
                  {label}
                </button>
              ))}
            </div>
          )}

          {isCandidate && !hasPrefs && !forYou && (
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-neutral-300">
              Расскажите, что ищете — направления, уровень и навыки, — и у каждой вакансии появится процент совпадения.{" "}
              <Link href="/profile#prefs" className="text-teal-300 hover:underline">Заполнить профиль</Link>
            </div>
          )}

          {forYou && (
            <div className="rounded-3xl border border-teal-300/25 bg-teal-300/[0.06] px-5 py-4 text-sm text-neutral-300">
              {hasPrefs ? (
                <>Вакансии отсортированы по совпадению с вашим профилем: направления, навыки, уровень, формат и город.{" "}
                  <Link href="/profile#prefs" className="text-teal-300 hover:underline">Изменить, что ищу</Link></>
              ) : (
                <>Подборка пока общая: укажите в профиле направления, уровень и навыки — и вакансии выстроятся под вас.{" "}
                  <Link href="/profile#prefs" className="text-teal-300 hover:underline">Заполнить за минуту</Link></>
              )}
            </div>
          )}

          {listLoading ? (
            <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-teal-300 border-t-transparent rounded-full animate-spin"></div></div>
          ) : loadError ? (
            <div className="text-center py-20 text-sm text-red-400">{loadError}</div>
          ) : list.length === 0 ? (
            <div className="text-center py-20 bg-white/[0.02] border border-dashed border-white/15 rounded-3xl">
              <p className="text-neutral-300 text-sm font-medium">Ничего не нашлось</p>
              <p className="text-neutral-500 text-xs mt-1">
                {savedMode ? "Нажмите «В избранное» на карточке, чтобы вернуться к вакансии позже"
                  : forYou ? "Свежих вакансий пока нет — загляните позже" : "Попробуйте ослабить фильтры"}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {list.map(card)}

              {savedMode ? null : forYou ? (
                recHasMore && (
                  <button
                    onClick={() => loadRecommended(recPage + 1)}
                    disabled={recLoading}
                    className="mx-auto mt-2 inline-flex items-center gap-2 px-6 py-3 bg-white/[0.06] hover:bg-white/[0.1] border border-white/15 rounded-full text-sm text-neutral-100 transition-colors disabled:opacity-50"
                  >
                    {recLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Загружаем…</> : "Показать ещё"}
                  </button>
                )
              ) : vacancies.length < total && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="mx-auto mt-2 inline-flex items-center gap-2 px-6 py-3 bg-white/[0.06] hover:bg-white/[0.1] border border-white/15 rounded-full text-sm text-neutral-100 transition-colors disabled:opacity-50"
                >
                  {loadingMore
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Загружаем…</>
                    : `Показать ещё (${Math.min(PAGE_SIZE, total - vacancies.length)} из ${total - vacancies.length})`}
                </button>
              )}
            </div>
          )}

          {savedMode && hiddenList.length > 0 && (
            <details className="rounded-3xl border border-white/10 bg-white/[0.03] px-5 py-4">
              <summary className="cursor-pointer text-sm text-neutral-300">Скрытые вакансии ({hiddenList.length})</summary>
              <ul className="mt-3 space-y-2">
                {hiddenList.map(v => (
                  <li key={v.id} className="flex items-center justify-between gap-3 text-sm">
                    <Link href={`/vacancy/${v.id}`} className="text-neutral-300 hover:text-teal-300 truncate">{v.title}</Link>
                    <button onClick={() => toggleMark(v, "hidden")} className="inline-flex items-center gap-1 text-xs text-teal-300 hover:underline shrink-0">
                      <Undo2 className="w-3.5 h-3.5" /> Вернуть в ленту
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </main>

      <SmartApply vacancy={applyVacancy} user={user} onClose={() => setApplyVacancy(null)} />
    </div>
  );
}