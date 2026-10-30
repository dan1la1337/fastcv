"use client";

import type { Conversation } from "@/lib/chat";
import { preview, shortTime } from "@/lib/chat";
import { UnreadDot } from "./useUnread";

const STATUS: Record<string, { text: string; className: string }> = {
  interview_scheduled: { text: "Собеседование", className: "text-emerald-300 bg-emerald-400/10" },
  rejected: { text: "Отказ", className: "text-neutral-400 bg-white/[0.06]" },
};

export default function ConversationList({ items, selected, onSelect }: {
  items: Conversation[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul aria-label="Диалоги" className="divide-y divide-white/[0.06]">
      {items.map(c => {
        const active = c.id === selected;
        const status = c.status ? STATUS[c.status] : undefined;
        return (
          <li key={c.id}>
            <button onClick={() => onSelect(c.id)} aria-current={active ? "true" : undefined}
              className={`w-full text-left px-4 py-3.5 flex gap-3 transition-colors ${active ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}>
              <span aria-hidden="true"
                className="shrink-0 w-10 h-10 rounded-full bg-indigo-400/15 text-indigo-200 flex items-center justify-center font-semibold">
                {c.other_name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={`truncate flex-1 ${c.unread ? "font-semibold text-white" : "text-neutral-200"}`}>{c.other_name}</span>
                  <span className="shrink-0 text-[11px] text-neutral-500">{shortTime(c.last_message_at)}</span>
                </span>
                <span className="flex items-center gap-1.5 text-xs text-neutral-500 truncate">
                  <span className="truncate">{c.vacancy_title}</span>
                  {status && <span className={`shrink-0 px-1.5 rounded ${status.className}`}>{status.text}</span>}
                </span>
                <span className="flex items-center gap-2 mt-0.5">
                  <span className={`truncate flex-1 text-sm ${c.unread ? "text-neutral-200" : "text-neutral-400"}`}>{preview(c)}</span>
                  <UnreadDot count={c.unread} />
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
