"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MessagesSquare } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Conversation } from "@/lib/chat";
import ConversationList from "@/components/chat/ConversationList";
import ChatThread from "@/components/chat/ChatThread";

const LIST_POLL_MS = 15_000;

export default function Messages({ initial }: { initial: string | null }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<"candidate" | "employer" | null>(null);
  const [list, setList] = useState<Conversation[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initial);

  const loadList = useCallback(async () => {
    const { data, error } = await supabase.rpc("my_conversations");
    if (!error) setList((data ?? []) as Conversation[]);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      loadList();
      if (!data.user) return;
      setUserId(data.user.id);
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
      setRole(profile?.role === "employer" ? "employer" : "candidate");
    });
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") loadList(); }, LIST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadList]);

  function open(id: string | null) {
    setSelected(id);
    // Адрес обновляем без перехода: страница не перезагружается, ссылку можно скопировать
    window.history.replaceState(null, "", id ? `/messages?c=${id}` : "/messages");
  }

  const current = list?.find(c => c.id === selected) ?? null;
  const back = role === "employer" ? { href: "/employer", label: "Кабинет" } : { href: "/applications", label: "Мои отклики" };

  return (
    <div className="min-h-screen text-neutral-100 p-3 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Link href={back.href} aria-label={back.label}
            className="p-2 bg-neutral-900 border border-white/10 rounded-xl hover:bg-white/[0.08] transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="font-display text-xl font-bold">Сообщения</h1>
        </div>

        {list === null ? (
          <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-teal-300" /></div>
        ) : list.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-white/15 rounded-3xl space-y-3 px-6">
            <MessagesSquare className="w-10 h-10 mx-auto text-neutral-600" aria-hidden="true" />
            <p className="text-neutral-300 text-sm font-medium">Пока нет переписки</p>
            <p className="text-neutral-500 text-sm max-w-md mx-auto">
              {role === "employer"
                ? "Чат открывается, когда кандидат откликается на вашу вакансию на FastCV."
                : "Чат с работодателем открывается после отклика на вакансию с отметкой «Прямой работодатель»."}
            </p>
            <Link href={role === "employer" ? "/employer" : "/"} className="inline-block text-sm text-teal-300 hover:text-teal-200">
              {role === "employer" ? "В кабинет" : "К вакансиям"}
            </Link>
          </div>
        ) : (
          <div className="glass rounded-3xl overflow-hidden grid md:grid-cols-[340px_1fr] h-[calc(100dvh-7.5rem)] sm:h-[calc(100dvh-9rem)] min-h-[420px]">
            <div className={`${selected ? "hidden md:block" : "block"} border-r border-white/10 overflow-y-auto`}>
              <ConversationList items={list} selected={selected} onSelect={open} />
            </div>
            <div className={`${selected ? "flex" : "hidden md:flex"} flex-col min-h-0`}>
              {current && userId ? (
                <ChatThread key={current.id} conversation={current} userId={userId}
                  onBack={() => open(null)} onChanged={loadList} />
              ) : selected && !current ? (
                <div className="m-auto text-center text-sm text-neutral-400 px-6 space-y-2">
                  <p>Этот диалог недоступен.</p>
                  <button onClick={() => open(null)} className="text-teal-300 hover:text-teal-200">К списку диалогов</button>
                </div>
              ) : (
                <p className="m-auto text-sm text-neutral-500 px-6 text-center">Выберите диалог слева</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
