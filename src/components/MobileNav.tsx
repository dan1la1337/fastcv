"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bookmark, Briefcase, LayoutList, MessageCircle, MessageSquare, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useUnread, UnreadDot } from "@/components/chat/useUnread";

type Item = { href: string; label: string; icon: typeof LayoutList; active: (path: string, tab: string | null) => boolean };

const FEED: Item = { href: "/", label: "Лента", icon: LayoutList, active: (p, t) => p === "/" && t !== "saved" };
const MESSAGES: Item = { href: "/messages", label: "Чаты", icon: MessageCircle, active: p => p.startsWith("/messages") };
const PROFILE: Item = { href: "/profile", label: "Профиль", icon: UserRound, active: p => p.startsWith("/profile") };
const CANDIDATE: Item[] = [
  FEED,
  { href: "/?tab=saved", label: "Избранное", icon: Bookmark, active: (p, t) => p === "/" && t === "saved" },
  { href: "/applications", label: "Отклики", icon: MessageSquare, active: p => p.startsWith("/applications") },
  MESSAGES,
  PROFILE,
];
const EMPLOYER: Item[] = [
  FEED,
  { href: "/employer", label: "Кабинет", icon: Briefcase, active: p => p.startsWith("/employer") },
  MESSAGES,
  PROFILE,
];

/**
 * Нижняя панель на телефоне для вошедших (макет «Аврора»): лента, избранное, отклики, профиль.
 * На странице вакансии её место занимает кнопка Smart Apply.
 */
export default function MobileNav() {
  const path = usePathname();
  const [items, setItems] = useState<Item[] | null>(null);
  const tab = useSearchParams().get("tab");
  const unread = useUnread(items !== null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
      setItems(profile?.role === "employer" ? EMPLOYER : CANDIDATE);
    });
  }, []);

  // На странице вакансии место занимает кнопка Smart Apply, в чате — поле ввода сообщения
  if (!items || path.startsWith("/vacancy/") || path.startsWith("/messages")) return null;
  return (
    <>
      <div className="h-24 sm:hidden" aria-hidden="true" />
      <nav aria-label="Разделы" className="sm:hidden fixed inset-x-3 bottom-3 z-40 rounded-full bg-[#0B0F19]/85 backdrop-blur-md border border-white/12">
        <ul className={`grid ${items.length === 5 ? "grid-cols-5" : "grid-cols-4"}`}>
          {items.map(item => {
            const active = item.active(path, tab);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                {/* Обычная ссылка, а не Link: лента читает ?tab только при загрузке */}
                <a href={item.href} aria-current={active ? "page" : undefined}
                  className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${active ? "text-teal-300 font-semibold" : "text-neutral-400"}`}>
                  <span className="relative">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                    {item === MESSAGES && <UnreadDot count={unread} label="чатов с новыми сообщениями" className="absolute -top-1.5 -right-3" />}
                  </span>
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
