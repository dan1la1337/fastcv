import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Logo from "@/components/Logo";

/** Верхняя панель внутренних страниц: логотип и возврат назад. Та же стеклянная полоса, что у ленты. */
export default function PageBar({ href = "/", label }: { href?: string; label: string }) {
  return (
    <header className="sticky top-0 z-20 px-3 sm:px-4 pt-3">
      <div className="glass rounded-3xl max-w-6xl mx-auto pl-4 pr-2.5 py-2.5 flex items-center gap-1 sm:gap-3">
        <Logo />
        <Link href={href} className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm text-neutral-300 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {label}
        </Link>
      </div>
    </header>
  );
}
