import Link from "next/link";
import Logo from "@/components/Logo";

const SECTIONS = {
  candidate: [["/", "Лента"], ["/applications", "Мои отклики"], ["/messages", "Сообщения"], ["/profile", "Профиль"]],
  employer: [["/", "Лента"], ["/employer", "Кабинет"], ["/resumes", "Резюме"], ["/messages", "Сообщения"], ["/profile", "Профиль"]],
} as const;

/** Верхняя панель разделов для вошедших на десктопе. На телефоне её место занимает нижняя панель. */
export default function AppBar({ role, current }: { role: "candidate" | "employer"; current: string }) {
  return (
    <header className="top-strip hidden sm:block sticky top-0 z-20 px-4 pt-3 pb-3">
      <div className="glass rounded-3xl max-w-6xl mx-auto pl-4 pr-2.5 py-2.5 flex items-center justify-between gap-3">
        <Logo />
        <nav aria-label="Разделы" className="flex items-center gap-2">
          {SECTIONS[role].map(([href, label]) => (
            <Link key={href} href={href} aria-current={href === current ? "page" : undefined}
              className={`lg px-4 py-2 rounded-full text-sm transition-colors ${href === current ? "lg-on" : "text-neutral-300 hover:text-white"}`}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
