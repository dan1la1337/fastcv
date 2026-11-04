import Link from "next/link";

/** Логотип Obsidian Glass: надпись FastCV стилем заголовка (600, ink), ведёт на главную. */
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" aria-label="FastCV — на главную"
      className={`font-display text-xl text-neutral-100 hover:text-white ${className}`}>
      FastCV
    </Link>
  );
}
