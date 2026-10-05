import { useT } from "../i18n/i18n";

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function CountdownRing({
  remaining,
  period,
  size = 18,
  showSeconds = true,
}: {
  remaining: number;
  period: number;
  size?: number;
  showSeconds?: boolean;
}) {
  const t = useT();
  const urgent = remaining <= 5;
  const critical = remaining <= 1;
  const offset = CIRCUMFERENCE * (1 - Math.min(Math.max(remaining / period, 0), 1));
  return (
    // Static label (not a live region): read on focus/browse, never announced every second.
    <span
      role="img"
      aria-label={t("codes.secondsLeft", { seconds: remaining })}
      className="flex shrink-0 items-center gap-1"
    >
      {urgent && showSeconds ? (
        <span
          aria-hidden="true"
          className={`min-w-[1ch] text-right font-mono text-[11px] tabular-nums ${critical ? "text-critical" : "text-warn"}`}
        >
          {remaining}
        </span>
      ) : null}
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        aria-hidden="true"
        data-urgent={String(urgent)}
        data-critical={String(critical)}
        className="shrink-0"
      >
        <circle cx={10} cy={10} r={RADIUS} fill="none" stroke="var(--ov-ring)" strokeWidth={1.5} />
        <circle
          cx={10}
          cy={10}
          r={RADIUS}
          fill="none"
          stroke={critical ? "var(--ov-critical)" : urgent ? "var(--ov-warn)" : "var(--ov-muted)"}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 10 10)"
        />
      </svg>
    </span>
  );
}
