import Link from "next/link";

/** Логотип «Бумага»: FASTCV разреженными прописными, шрифт Jost, ведёт на главную. */
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" aria-label="FastCV — на главную"
      className={`font-display text-lg uppercase tracking-[0.2em] text-neutral-100 hover:text-white ${className}`}>
      fastcv
    </Link>
  );
}
