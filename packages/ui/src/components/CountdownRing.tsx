const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function CountdownRing({
  remaining,
  period,
  size = 18,
}: {
  remaining: number;
  period: number;
  size?: number;
}) {
  const urgent = remaining <= 5;
  const critical = remaining <= 1;
  const offset = CIRCUMFERENCE * (1 - Math.min(Math.max(remaining / period, 0), 1));
  return (
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
  );
}
