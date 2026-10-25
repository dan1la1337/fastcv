import { fetchLiveStats } from "@/lib/live";

// Счётчик опрашивают все открытые главные раз в минуту — база отвечает не чаще раза в минуту
export const revalidate = 60;

export async function GET() {
  const stats = await fetchLiveStats();
  if (!stats) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json(stats);
}
