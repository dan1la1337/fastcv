import type { Metadata } from "next";
import Messages from "./Messages";

export const metadata: Metadata = { title: "Сообщения — FastCV", robots: { index: false } };

type Props = { searchParams: Promise<{ c?: string }> };

/** Чат кандидата и работодателя: список диалогов и переписка (?c=<id диалога>). */
export default async function MessagesPage({ searchParams }: Props) {
  const { c } = await searchParams;
  return <Messages initial={typeof c === "string" ? c : null} />;
}
