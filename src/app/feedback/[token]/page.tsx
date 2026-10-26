import type { Metadata } from "next";
import InterviewFeedback from "./InterviewFeedback";

export const metadata: Metadata = { title: "Оценка собеседования — FastCV", robots: { index: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ r?: string }> };

/** Ссылка из бота: «Как прошло собеседование?» с выбранной оценкой в ?r=1..5. */
export default async function FeedbackPage({ params, searchParams }: Props) {
  const { token } = await params;
  const r = Number((await searchParams).r);
  return <InterviewFeedback token={token} initial={Number.isInteger(r) && r >= 1 && r <= 5 ? r : null} />;
}
