const R = 70;
const C = 2 * Math.PI * R;

/** Кольцо совпадения (ink на треке steel): заполняется до процента при появлении. */
export default function MatchRing({ value, size = 160, label = true, stroke = "#5eead4" }: { value: number; size?: number; label?: boolean; stroke?: string }) {
  const to = C * (1 - value / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg role="img" aria-label={`Совпадение ${value} процентов`} width={size} height={size} viewBox="0 0 160 160">
        <circle cx="80" cy="80" r={R} fill="none" stroke="#2b2c31" strokeWidth="10" />
        <circle className="ring-fill" cx="80" cy="80" r={R} fill="none" stroke={stroke} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={to} transform="rotate(-90 80 80)"
          style={{ ["--ring-from" as string]: C, ["--ring-to" as string]: to }} />
      </svg>
      {label && (
        <p className="absolute inset-0 m-0 flex items-center justify-center font-display" style={{ fontSize: Math.max(13, size * 0.21) }}>
          {value}%
        </p>
      )}
    </div>
  );
}

