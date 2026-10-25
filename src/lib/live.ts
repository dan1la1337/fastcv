import { supabase } from "@/lib/supabase";

/** Живой счётчик главной: вакансий в ленте, новых за сутки, когда пришла последняя, источники. */
export interface LiveStats {
  total: number;
  new_24h: number;
  last_at: string | null;
  channels: number;
  companies: number;
}

export async function fetchLiveStats(): Promise<LiveStats | null> {
  const { data, error } = await supabase.rpc("live_stats");
  if (error || !data) return null;
  const d = data as unknown as LiveStats;
  return {
    total: Number(d.total) || 0, new_24h: Number(d.new_24h) || 0, last_at: d.last_at ?? null,
    channels: Number(d.channels) || 0, companies: Number(d.companies) || 0,
  };
}

/** «только что», «3 мин назад», «2 ч назад» */
export function agoLabel(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.floor(minutes / 60)} ч назад`;
}
