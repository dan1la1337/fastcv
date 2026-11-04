import { AlertCircle } from "lucide-react";

/** Ошибка формы: заметна на тёмной карточке и не держится на одном цвете, рядом значок. */
export default function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-400/50 bg-red-950 px-4 py-3 text-sm text-red-100">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-300" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
