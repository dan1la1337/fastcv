import Logo from "@/components/Logo";
import { BackLink } from "@/components/PageBar";
import UserMenu from "@/components/UserMenu";

/**
 * Верхняя панель для вошедших на десктопе: рядом с логотипом путь обратно в ленту, в разделы и к выходу ведёт меню аккаунта.
 * На телефоне её место занимает нижняя панель.
 */
export default function AppBar({ role }: { role: "candidate" | "employer" }) {
  return (
    <header className="top-strip hidden sm:block sticky top-0 z-20 px-4 pt-3 pb-3">
      <div className="glass rounded-3xl max-w-6xl mx-auto pl-4 pr-2.5 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Logo />
          <BackLink label="К ленте" />
        </div>
        <UserMenu role={role} />
      </div>
    </header>
  );
}
