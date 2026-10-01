import qrcode from "qrcode-generator";
import { useMemo } from "react";

export function QrCode({
  value,
  label,
  size = 184,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const { count, cells } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const dark: string[] = [];
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++)
        if (qr.isDark(row, col)) dark.push(`M${col} ${row}h1v1h-1z`);
    }
    return { count: n, cells: dark.join("") };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`-2 -2 ${count + 4} ${count + 4}`}
      shapeRendering="crispEdges"
    >
      <rect x={-2} y={-2} width={count + 4} height={count + 4} fill="#ffffff" />
      <path d={cells} fill="#000000" />
    </svg>
  );
}
