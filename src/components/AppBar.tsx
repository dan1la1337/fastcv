import Logo from "@/components/Logo";
import UserMenu from "@/components/UserMenu";

/**
 * Верхняя панель для вошедших на десктопе: в ленту ведёт логотип, в разделы и к выходу — меню аккаунта.
 * На телефоне её место занимает нижняя панель.
 */
export default function AppBar({ role }: { role: "candidate" | "employer" }) {
  return (
    <header className="top-strip hidden sm:block sticky top-0 z-20 px-4 pt-3 pb-3">
      <div className="glass rounded-3xl max-w-6xl mx-auto pl-4 pr-2.5 py-2.5 flex items-center justify-between gap-3">
        <Logo />
        <UserMenu role={role} />
      </div>
    </header>
  );
}
