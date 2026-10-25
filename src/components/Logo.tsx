import Link from "next/link";

/** Логотип «Аврора»: строчное fastcv шрифтом Unbounded, ведёт на главную. */
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" aria-label="FastCV — на главную"
      className={`font-display font-bold text-lg tracking-tight text-neutral-100 hover:text-white ${className}`}>
      fastcv
    </Link>
  );
}
