"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchVacancyPage, formatSalary, PAGE_SIZE, SPECIALTIES, type Vacancy, type VacancyFilters } from "@/lib/vacancies";
import { Search, MapPin, Send, ChevronRight, X, Sparkles, Loader2, Copy, Check, Mail, ExternalLink, Globe } from "lucide-react";
import Link from "next/link";

export default function Home() {
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);

  // Фильтры
  const [search, setSearch] = useState("");
  const [onlyRemote, setOnlyRemote] = useState(false);
  const [minSalary, setMinSalary] = useState<number>(0);
  const [onlyWithSalary, setOnlyWithSalary] = useState<boolean>(false);
  const [city, setCity] = useState("");

  const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>(null);
  const [selectedStack, setSelectedStack] = useState<string[]>([]);

  // Состояния модального окна Smart Apply
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [selectedVacancy, setSelectedVacancy] = useState<Vacancy | null>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Состояние окна подтверждения для Email / Внешних контактов
  const [successContactModal, setSuccessContactModal] = useState<{
    open: boolean;
    type: string;
    value: string;
    vacancyTitle: string;
  }>({ open: false, type: "", value: "", vacancyTitle: "" });
  
  const [copiedEmail, setCopiedEmail] = useState(false);

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

  // --- ЛОГИКА SMART APPLY ---
  const openApplyModal = (vacancy: Vacancy) => {
    setSelectedVacancy(vacancy);
    setCoverLetter("");
    setGenerationError(null);
    setApplyModalOpen(true);
  };

  const generateCoverLetter = async () => {
    if (!selectedVacancy) return;
    setIsGenerating(true);
    setGenerationError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setGenerationError("Войдите, чтобы сгенерировать письмо.");
        return;
      }

      const res = await fetch("/api/cover-letter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ vacancyId: selectedVacancy.id }),
      });
      const data = await res.json();
      if (res.ok && data.text) {
        setCoverLetter(data.text);
      } else {
        setGenerationError(data.error || "Не удалось сгенерировать письмо. Попробуйте ещё раз.");
      }
    } catch {
      setGenerationError("Не удалось связаться с сервером. Попробуйте ещё раз.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
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
              {loading ? "…" : `${total} вакансий`}
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

                <button 
                  onClick={() => window.location.href = '/profile'}
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-blue-600/20 border border-blue-500/50 text-blue-400 font-bold cursor-pointer hover:bg-blue-600/30 transition-colors relative z-50"
                  title="Перейти в личный кабинет"
                >
                  {user.email?.charAt(0).toUpperCase()}
                </button>
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
                      <h2 className="text-xl font-bold text-neutral-100">{item.title}</h2>
                      <p className="text-base font-semibold text-emerald-400 mt-1">{formatSalary(item.salary_min, item.salary_max)}</p>
                      {(item.city || item.is_remote) && (
                        <p className="flex flex-wrap items-center gap-3 text-xs text-neutral-400 mt-2">
                          {item.city && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{item.city}</span>}
                          {item.is_remote && <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" />Удалённо</span>}
                        </p>
                      )}
                    </div>
                    
                    <button
                      onClick={() => openApplyModal(item)}
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

      {/* --- МОДАЛЬНОЕ ОКНО SMART APPLY --- */}
      {applyModalOpen && selectedVacancy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            
            <div className="flex items-center justify-between p-5 border-b border-neutral-800 bg-neutral-950/50">
              <div>
                <h3 className="text-lg font-bold text-white">Отклик с ИИ</h3>
                <p className="text-sm text-neutral-400">{selectedVacancy.title}</p>
              </div>
              <button onClick={() => setApplyModalOpen(false)} className="text-neutral-500 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {!coverLetter ? (
                <div className="bg-blue-950/20 border border-blue-500/20 rounded-xl p-6 text-center space-y-4">
                  <Sparkles className="w-10 h-10 text-blue-400 mx-auto" />
                  <div>
                    <h4 className="text-white font-medium mb-1">Сгенерировать идеальное письмо?</h4>
                    <p className="text-sm text-neutral-400">LLM-агент проанализирует твой профиль и требования вакансии, чтобы составить уникальное сопроводительное.</p>
                  </div>
                  {user ? (
                    <button 
                      onClick={generateCoverLetter} 
                      disabled={isGenerating}
                      className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {isGenerating ? <><Loader2 className="w-4 h-4 animate-spin" /> Анализируем...</> : 'Начать магию'}
                    </button>
                  ) : (
                    <Link
                      href="/login"
                      className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      Войдите, чтобы откликнуться
                    </Link>
                  )}
                  {generationError && (
                    <p className="text-sm text-red-400">{generationError}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                  <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Сопроводительное письмо</label>
                  <textarea 
                    value={coverLetter}
                    onChange={(e) => setCoverLetter(e.target.value)}
                    className="w-full h-64 bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-sm text-neutral-200 focus:outline-none focus:border-blue-500 leading-relaxed resize-none"
                  />
                  <p className="text-xs text-neutral-500">Ты можешь отредактировать текст перед отправкой.</p>
                </div>
              )}
            </div>

            {coverLetter && (
              <div className="p-5 border-t border-neutral-800 bg-neutral-950/50 flex justify-end gap-3">
                <button onClick={() => setCoverLetter("")} className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors">Переписать</button>
                
                <button 
                  onClick={async () => {
                    if (!user) {
                      alert("Сначала войдите в систему");
                      return;
                    }

                    const { error } = await supabase.from("applications").insert({
                      vacancy_id: selectedVacancy.id,
                      candidate_id: user.id,
                      cover_letter: coverLetter,
                      status: 'new'
                    });

                    if (error) {
                      alert(error.code === "23505"
                        ? "Вы уже откликались на эту вакансию."
                        : "Ошибка отправки: " + error.message);
                      return;
                    }

                    // Копируем сопроводительное письмо кандидату в буфер обмена для удобства
                    navigator.clipboard.writeText(coverLetter);

                    setApplyModalOpen(false);

                    // Разделяем поведение контактов
                    if (selectedVacancy.source_type === 'external' && selectedVacancy.contact_value) {
                      if (selectedVacancy.contact_type === 'email') {
                        // Показываем модальное окно для отправки на Email без навязчивого Outlook
                        setSuccessContactModal({
                          open: true,
                          type: 'email',
                          value: selectedVacancy.contact_value,
                          vacancyTitle: selectedVacancy.title
                        });
                      } else {
                        // Для Telegram
                        const contactLink = `https://t.me/${selectedVacancy.contact_value.replace('@', '')}`;
                        window.open(contactLink, '_blank');
                      }
                    } else if (selectedVacancy.source_type === 'external') {
                      // Контакта в посте нет — открываем оригинал, там есть ссылка на отклик
                      if (selectedVacancy.source_url) window.open(selectedVacancy.source_url, '_blank');
                      alert("Письмо скопировано. Контакта в посте нет — откликнитесь по ссылке из оригинального поста.");
                    } else {
                      // Внутренняя вакансия — перенаправляем в диалоги платформы
                      alert("Отклик доставлен работодателю в личный кабинет!");
                      window.location.href = '/applications';
                    }
                  }}
                  className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer"
                >
                  <Send className="w-4 h-4" /> Отправить HR
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* --- МОДАЛЬНОЕ ОКНО ДЛЯ EMAIL-ВАКАНСИЙ (БЕЗ ПРИНУДИТЕЛЬНОГО OUTLOOK) --- */}
      {successContactModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg p-6 space-y-6 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
              <div className="flex items-center gap-2.5 text-emerald-400">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Check className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-white text-base">Отклик сформирован</h3>
              </div>
              <button onClick={() => setSuccessContactModal({ ...successContactModal, open: false })} className="text-neutral-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-neutral-400">
                Текст сопроводительного письма <span className="text-emerald-400 font-semibold">уже скопирован в буфер обмена</span>. Отправьте резюме на почту работодателя:
              </p>

              {/* Поле с адресом почты и кнопкой копирования */}
              <div className="flex items-center justify-between bg-neutral-950 border border-neutral-800 rounded-xl p-3.5">
                <div className="flex items-center gap-3 overflow-hidden">
                  <Mail className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="text-sm font-mono text-neutral-200 truncate">{successContactModal.value}</span>
                </div>
                <button
                  onClick={() => handleCopy(successContactModal.value)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium transition-colors shrink-0 ml-2"
                >
                  {copiedEmail ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedEmail ? "Скопировано" : "Скопировать"}
                </button>
              </div>

              {/* Кнопки выбора способа отправки */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                <a
                  href={`https://mail.google.com/mail/?view=cm&fs=1&to=${successContactModal.value}&su=Отклик на вакансию: ${encodeURIComponent(successContactModal.vacancyTitle)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 py-2.5 px-4 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-xl text-xs font-semibold text-neutral-200 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-red-400" /> Открыть в Gmail
                </a>

                <a
                  href={`mailto:${successContactModal.value}?subject=Отклик на вакансию: ${encodeURIComponent(successContactModal.vacancyTitle)}`}
                  className="flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-semibold text-white transition-colors"
                >
                  <Mail className="w-3.5 h-3.5" /> Написать на почту
                </a>
              </div>
            </div>

            <button
              onClick={() => setSuccessContactModal({ ...successContactModal, open: false })}
              className="w-full py-2.5 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 text-xs font-medium rounded-xl transition-colors"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}