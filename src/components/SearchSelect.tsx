"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  /** Подзаголовок группы (например, «Разработка и данные»). */
  group?: string;
  /** Число справа (например, сколько вакансий). */
  count?: number;
  /** Дополнительные слова для поиска (синонимы, технологии). */
  keywords?: string[];
}

/**
 * Выпадающий список с поиском: открывается с анимацией, фильтрует по названию и
 * ключевым словам, управляется с клавиатуры (↑ ↓ Enter Esc). Одно значение или пусто.
 */
export default function SearchSelect({
  label, placeholder, options, value, onChange, emptyLabel = "Любое",
}: {
  label: string;
  placeholder: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || o.keywords?.some(k => k.toLowerCase().includes(q)));
  }, [options, query]);

  // Клик вне списка закрывает его
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function toggle() {
    setOpen(o => !o);
    setQuery("");
    setActive(0);
    setTimeout(() => input.current?.focus(), 0);
  }

  function pick(next: string) {
    onChange(next);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && filtered[active]) { e.preventDefault(); pick(filtered[active].value); }
  }

  const selected = options.find(o => o.value === value);

  return (
    <div ref={root} className="relative">
      <button type="button" onClick={toggle} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        className="w-full flex items-center justify-between gap-2 pl-3 pr-14 py-2.5 bg-neutral-950 border border-neutral-800 rounded-lg text-sm text-left hover:border-neutral-700 focus:outline-none focus:border-teal-300 transition-colors">
        <span className={selected ? "text-neutral-100" : "text-neutral-500"}>{selected?.label ?? emptyLabel}</span>
      </button>
      <span className="absolute right-2 top-0 h-[42px] flex items-center gap-1 pointer-events-none">
        {selected && (
          <button type="button" aria-label="Сбросить" onClick={() => onChange("")}
            className="pointer-events-auto p-0.5 rounded hover:bg-neutral-800 text-neutral-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
        )}
        <ChevronDown className={`w-4 h-4 text-neutral-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </span>

      <div
        className={`absolute z-30 mt-1.5 w-full origin-top rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl shadow-black/50 transition-all duration-150 ease-out ${
          open ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 -translate-y-1 pointer-events-none"}`}
        aria-hidden={!open}
      >
        <div className="relative p-2 border-b border-neutral-800">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
          <input ref={input} value={query} onChange={e => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey}
            placeholder={placeholder} aria-controls={listId} tabIndex={open ? 0 : -1}
            className="w-full pl-8 pr-2 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm text-neutral-100 focus:outline-none focus:border-teal-300" />
        </div>
        <ul id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto p-1">
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-neutral-500">Ничего не нашлось</li>}
          {filtered.map((o, i) => {
            const header = o.group && o.group !== filtered[i - 1]?.group ? o.group : null;
            return (
              <li key={o.value}>
                {header && <p className="px-3 pt-2 pb-1 text-[11px] text-neutral-500">{header}</p>}
                <button type="button" role="option" aria-selected={o.value === value} tabIndex={-1}
                  onMouseEnter={() => setActive(i)} onClick={() => pick(o.value)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-sm text-left transition-colors ${
                    i === active ? "bg-neutral-800 text-white" : "text-neutral-300"}`}>
                  <span className="flex items-center gap-2">
                    {o.value === value ? <Check className="w-3.5 h-3.5 text-teal-300" /> : <span className="w-3.5" />}
                    {o.label}
                  </span>
                  {o.count !== undefined && <span className="text-xs text-neutral-500">{o.count}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
