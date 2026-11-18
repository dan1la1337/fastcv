"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { DEFAULT_FILTERS, fetchVacancyPage, plural, PAGE_SIZE, VACANCY_FORMS, type Area, type Vacancy, type VacancyFilters } from "@/lib/vacancies";
import { Search, Loader2, SlidersHorizontal, X } from "lucide-react";
import { toast } from "@/components/Toaster";
import { fetchMarked } from "@/lib/marks";
import { fetchMatches, fetchRecommended, type Match } from "@/lib/matching";
import type { Tables } from "@/lib/database.types";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import dynamic from "next/dynamic";
import { activeFilters as listActiveFilters, cityOptions as toCityOptions, mergeById, withArea, withCountry } from "@/lib/feed-filters";
import FeedHeader from "@/components/feed/FeedHeader";
import FeedFilters from "@/components/feed/FeedFilters";
import { AreaTabs, ModeTabs, type FeedMode } from "@/components/feed/FeedTabs";
import HiddenVacancies from "@/components/feed/HiddenVacancies";
import VacancyCard from "@/components/feed/VacancyCard";
import { useFeedOptions } from "@/components/feed/useFeedOptions";
import { useVacancyMarks } from "@/components/feed/useVacancyMarks";

// Окно Smart Apply нужно только по клику: его код не грузим вместе с лентой
const SmartApply = dynamic(() => import("@/components/SmartApply"), { ssr: false });

/**
 * Лента вакансий с фильтрами. Первую страницу без фильтров сервер отдаёт сразу
 * в HTML (initialRows): лента видна до загрузки скриптов и индексируется поисковиками.
 * Дальше — запросы из браузера при смене фильтров и «Показать ещё».
 */
const neverChanges = () => () => {};
// То же условие, что у скрипта в layout.tsx
const readSessionCookie = () => /(^|; )sb-[^=]+-auth-token/.test(document.cookie);

export default function Feed({ initialRows, initialTotal, hero, after }: { initialRows: Vacancy[] | null; initialTotal: number; hero?: React.ReactNode; after?: React.ReactNode }) {
  const [vacancies, setVacancies] = useState<Vacancy[]>(initialRows ?? []);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(initialRows === null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  // Пока сессия проверяется, верим куке: иначе при переходе из кабинета вошедший на миг увидит экран гостя
  const hasSessionCookie = useSyncExternalStore(neverChanges, readSessionCookie, () => false);
  const signedIn = Boolean(user) || (hasSessionCookie && !authChecked);
  const [userProfile, setUserProfile] = useState<Pick<Tables<"profiles">, "role" | "skills" | "pref_directions" | "pref_level"> | null>(null);

  // «Для вас»: подборка по профилю кандидата и процент совпадения на карточках
  const [mode, setMode] = useState<FeedMode>("all");

  // Избранное и скрытые: отметки пользователя на вакансиях
  const hiddenRef = useRef<string[]>([]);
  const [savedList, setSavedList] = useState<Vacancy[]>([]);
  const [hiddenList, setHiddenList] = useState<Vacancy[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [matches, setMatches] = useState<Record<string, Match>>({});
  const { cities, countryOptions, benchmarks } = useFeedOptions();
  const requestedMatches = useRef(new Set<string>());
  const [recommended, setRecommended] = useState<Vacancy[]>([]);
  const [recPage, setRecPage] = useState(0);
  const [recHasMore, setRecHasMore] = useState(false);
  const [recLoading, setRecLoading] = useState(false);

  // Фильтры применяются в базе: так поиск идёт по всем вакансиям, а не по
  // первой тысяче, и страница грузит только PAGE_SIZE карточек за раз.
  const [filters, setFilters] = useState<VacancyFilters>(DEFAULT_FILTERS);
  const { search, area } = filters;
  const cityOptions = toCityOptions(cities, filters.country);
  const chooseCountry = (value: string) => setFilters(f => withCountry(f, value, cities));
  const chooseArea = (next: Area | "") => setFilters(f => withArea(f, next));
  // На телефоне фильтры свёрнуты, иначе они занимают весь первый экран
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Вакансия, на которую сейчас откликаются (окно Smart Apply)
  const [applyVacancy, setApplyVacancy] = useState<Vacancy | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setAuthChecked(true);
      // Кука могла пережить сессию: снимаем метку входа, чтобы гость увидел кнопку входа и приветствие
      if (!data.user) delete document.documentElement.dataset.auth;
      if (data.user) {
        setUser(data.user);
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, skills, pref_directions, pref_level")
          .eq("id", data.user.id)
          .single();
        if (profile) setUserProfile(profile);
        // Кандидату с заполненным профилем сразу подборка «Для вас»: зачем ему вся лента.
        // «/?tab=all» — явно общая лента (например, из ссылки «Все вакансии»).
        const tab = new URLSearchParams(window.location.search).get("tab");
        const filled = Boolean(profile?.pref_directions?.length
          || (Array.isArray(profile?.skills) && profile.skills.length >= 3));
        if (profile?.role === "candidate" && (tab === "for-you" || (!tab && filled))) {
          setMode("for-you");
          void loadRecommended(0);
        }
        // «/?tab=saved» — нижняя панель на телефоне ведёт сразу в избранное
        if (profile?.role === "candidate" && tab === "saved") void showSaved();
      }
    });
  }, []);

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

  async function loadMore() {
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const { rows, total } = await fetchVacancyPage(filters, page + 1, hiddenRef.current);
      if (id !== requestId.current) return;
      setVacancies(prev => mergeById(prev, rows));
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

  const { marks, pendingMarks, toggleMark } = useVacancyMarks({ userId: user?.id, isCandidate, hiddenRef, setSavedList, setHiddenList });

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
      setRecommended(prev => nextPage === 0 ? rows : mergeById(prev, rows));
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

  const forYou = mode === "for-you";
  const savedMode = mode === "saved";
  const notHidden = (v: Vacancy) => marks.get(v.id) !== "hidden";
  const list = savedMode ? savedList : (forYou ? recommended : vacancies).filter(notHidden);
  const listLoading = savedMode ? savedLoading : forYou ? recLoading && recommended.length === 0 : loading;

  // Что сейчас сужает ленту: показываем над результатами, каждое условие снимается по клику
  const activeFilters = listActiveFilters(filters);
  const clearAllFilters = () => activeFilters.forEach(f => setFilters(f.clear));

  return (
    <div className="min-h-screen text-neutral-100 antialiased font-sans relative">
      <FeedHeader loading={loading} total={total} signedIn={signedIn} isEmployer={isEmployer} email={user?.email} />

      {!signedIn && hero}
      {/* Вторая строка сетки забирает лишнюю высоту: колонка фильтров занимает обе строки и не растягивает строку поиска */}
      <main id="feed" className="max-w-page mx-auto px-4 py-6 lg:py-8 grid grid-cols-1 lg:grid-cols-4 lg:grid-rows-[auto_1fr] gap-y-4 lg:gap-x-8 relative z-0 scroll-mt-20">
        {/* Поиск над результатами, рядом кнопка фильтров: на телефоне они свёрнуты и открываются под этой строкой */}
        <div className="lg:col-start-2 lg:col-span-3 lg:row-start-1 flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" aria-hidden="true" />
            <input id="feed-search" type="search" aria-label="Поиск по вакансиям" placeholder="Должность или навык: Java, Backend..." value={search}
              onChange={(e) => { const value = e.target.value; setFilters(f => ({ ...f, search: value })); if (mode !== "all") setMode("all"); }} className="neu-in w-full h-12 pl-10 pr-4 text-sm text-neutral-100" />
          </div>
          <button
            onClick={() => setFiltersOpen(open => !open)}
            aria-expanded={filtersOpen}
            aria-label={`Фильтры${activeFilters.length ? `: выбрано ${activeFilters.length}` : ""}`}
            className="lg lg:hidden shrink-0 inline-flex items-center justify-center gap-1.5 h-12 min-w-12 px-3 rounded-full text-sm text-neutral-200"
          >
            <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
            {activeFilters.length > 0 && <span className="text-xs tabular-nums text-teal-200">{activeFilters.length}</span>}
          </button>
        </div>

        <FeedFilters filters={filters} setFilters={setFilters} open={filtersOpen}
          cityOptions={cityOptions} countryOptions={countryOptions} chooseCountry={chooseCountry} />

        {/* Vacancies Feed */}
        <section className="lg:col-start-2 lg:col-span-3 lg:row-start-2 min-w-0 space-y-4">
          <AreaTabs area={area} chooseArea={chooseArea} />
          {isCandidate && <ModeTabs mode={mode} showForYou={showForYou} showSaved={showSaved} showAll={() => setMode("all")} />}

          {isCandidate && !hasPrefs && !forYou && (
            <div className="neu-sub rounded-3xl px-5 py-4 text-sm text-neutral-300">
              Расскажите, что ищете — направления, уровень и навыки, — и у каждой вакансии появится процент совпадения.{" "}
              <Link href="/profile#prefs" className="text-teal-300 hover:underline">Заполнить профиль</Link>
            </div>
          )}

          {forYou && (
            <p className="text-xs text-neutral-400">
              {hasPrefs ? (
                <>Сначала — самые подходящие вашему профилю. <Link href="/profile#prefs" className="text-teal-300 hover:underline">Изменить, что ищу</Link></>
              ) : (
                <>Подборка пока общая: укажите в профиле направления, уровень и навыки — и вакансии выстроятся под вас.{" "}
                  <Link href="/profile#prefs" className="text-teal-300 hover:underline">Заполнить за минуту</Link></>
              )}
            </p>
          )}

          {mode === "all" && !listLoading && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-live="polite">
              <p className="text-lg font-semibold text-neutral-100 tabular-nums">{total.toLocaleString("ru-RU")} {plural(total, VACANCY_FORMS)}</p>
              {activeFilters.map(f => (
                <button key={f.key} onClick={() => setFilters(f.clear)} aria-label={`${f.label}: снять условие`}
                  className="lg inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs text-neutral-200 transition-colors">
                  {f.label} <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              ))}
              {activeFilters.length > 1 && (
                <button onClick={() => clearAllFilters()} className="text-xs text-neutral-400 hover:text-white transition-colors">Сбросить всё</button>
              )}
            </div>
          )}

          {listLoading ? (
            <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-teal-300 border-t-transparent rounded-full animate-spin"></div></div>
          ) : loadError ? (
            <div className="text-center py-20 text-sm text-red-400">{loadError}</div>
          ) : list.length === 0 ? (
            <div className="neu-sub text-center py-20 rounded-3xl">
              <p className="text-neutral-300 text-sm font-medium">Ничего не нашлось</p>
              <p className="text-neutral-500 text-xs mt-1">
                {savedMode ? "Нажмите «В избранное» на карточке, чтобы вернуться к вакансии позже"
                  : forYou ? "Свежих вакансий пока нет — загляните позже" : "Попробуйте ослабить фильтры"}
              </p>
              {mode === "all" && activeFilters.length > 0 && (
                <button onClick={() => clearAllFilters()} className="lg mt-5 inline-flex items-center h-11 px-5 rounded-full text-sm text-neutral-100 transition-colors">
                  Сбросить фильтры
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {list.map(item => (
                <VacancyCard
                  key={item.id}
                  item={item}
                  // Без заполненного профиля оценка у всех одинаковая — не показываем её
                  match={hasPrefs ? matches[item.id] : undefined}
                  benchmarks={benchmarks}
                  isCandidate={isCandidate}
                  savedMode={savedMode}
                  mark={marks.get(item.id)}
                  pending={pendingMarks.has(item.id)}
                  addingSkill={addingSkill}
                  onApply={setApplyVacancy}
                  onAddSkill={addSkill}
                  onToggleMark={toggleMark}
                />
              ))}

              {savedMode ? null : forYou ? (
                recHasMore && (
                  <button
                    onClick={() => loadRecommended(recPage + 1)}
                    disabled={recLoading}
                    className="lg mx-auto mt-2 inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm text-neutral-100 transition-colors disabled:opacity-50"
                  >
                    {recLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Загружаем…</> : "Показать ещё"}
                  </button>
                )
              ) : vacancies.length < total && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="lg mx-auto mt-2 inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm text-neutral-100 transition-colors disabled:opacity-50"
                >
                  {loadingMore
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Загружаем…</>
                    : `Показать ещё (${Math.min(PAGE_SIZE, total - vacancies.length)} из ${total - vacancies.length})`}
                </button>
              )}
            </div>
          )}

          {savedMode && hiddenList.length > 0 && <HiddenVacancies hiddenList={hiddenList} onToggleMark={toggleMark} />}
        </section>
      </main>

      {!signedIn && after}

      {applyVacancy && <SmartApply vacancy={applyVacancy} user={user} onClose={() => setApplyVacancy(null)} />}
    </div>
  );
}
