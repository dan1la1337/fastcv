"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, LogOut, MessageCircle, MessageSquare, UserRound, Users, type LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useUnread, UnreadDot } from "@/components/chat/useUnread";

type Role = "candidate" | "employer";
type Item = { href: string; label: string; icon: LucideIcon };

const MESSAGES: Item = { href: "/messages", label: "Сообщения", icon: MessageCircle };
const PROFILE: Item = { href: "/profile", label: "Профиль", icon: UserRound };
const ITEMS: Record<Role, Item[]> = {
  candidate: [{ href: "/applications", label: "Мои отклики", icon: MessageSquare }, MESSAGES, PROFILE],
  employer: [{ href: "/employer", label: "Кабинет", icon: Briefcase }, { href: "/resumes", label: "Резюме", icon: Users }, MESSAGES, PROFILE],
};

const ROW = "flex items-center gap-2.5 w-full min-h-11 px-3 rounded-xl text-sm text-left transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none";

/** Кружок с буквой аккаунта в шапке: открывает меню с разделами и выходом. */
export default function UserMenu({ role, email: givenEmail }: { role: Role; email?: string | null }) {
  const [open, setOpen] = useState(false);
  const [loadedEmail, setLoadedEmail] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const path = usePathname();
  const unread = useUnread(true);
  const email = givenEmail ?? loadedEmail;

  useEffect(() => {
    if (givenEmail) return;
    // Только для подписи в меню: права проверяет сервер, поэтому хватает локальной сессии
    supabase.auth.getSession().then(({ data }) => setLoadedEmail(data.session?.user.email ?? null));
  }, [givenEmail]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key === "Tab") return setOpen(false);
    const rows = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: (at + 1) % rows.length, ArrowUp: (at - 1 + rows.length) % rows.length, Home: 0, End: rows.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    rows[next]?.focus();
  }

  async function logOut() {
    await supabase.auth.signOut();
    // Полная загрузка: метка входа на <html> и состояние ленты собираются заново, router.push этого не делает
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/";
  }

  return (
    <div ref={root} className="relative">
      <button ref={trigger} type="button" onClick={() => setOpen(value => !value)}
        aria-label="Меню профиля" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        className="lg w-10 h-10 flex items-center justify-center rounded-full text-neutral-100 font-semibold cursor-pointer transition-colors">
        {email ? email.charAt(0).toUpperCase() : <UserRound className="w-4 h-4" aria-hidden="true" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/15 bg-neutral-900 p-1.5 shadow-2xl shadow-black/60">
          {email && <p className="px-3 pt-2 pb-2.5 text-xs text-neutral-400 truncate" title={email}>{email}</p>}
          <div ref={menu} id={menuId} role="menu" aria-label="Меню профиля" onKeyDown={onMenuKey}>
            {ITEMS[role].map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} role="menuitem" onClick={() => setOpen(false)}
                aria-current={path.startsWith(href) ? "page" : undefined}
                className={`${ROW} ${path.startsWith(href) ? "text-teal-200" : "text-neutral-200"}`}>
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{label}</span>
                {href === MESSAGES.href && <UnreadDot count={unread} label="чатов с новыми сообщениями" />}
              </Link>
            ))}
            <div role="separator" className="my-1.5 border-t border-white/10" />
            <button type="button" role="menuitem" onClick={logOut} className={`${ROW} text-neutral-200`}>
              <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
              Выйти
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
