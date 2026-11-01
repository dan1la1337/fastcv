import Link from "next/link";

/** Логотип по стилю wordmark дизайн-системы Soft: FASTCV тонкими разреженными прописными, ведёт на главную. */
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" aria-label="FastCV — на главную"
      className={`font-display font-light text-lg uppercase tracking-[0.08em] text-neutral-100 hover:text-white ${className}`}>
      fastcv
    </Link>
  );
}
