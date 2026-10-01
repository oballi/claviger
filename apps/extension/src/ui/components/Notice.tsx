import type { ReactNode } from "react";

/** The design's tagged note: a small uppercase label ("ÖNEMLİ", "BİR KEZ") and a sentence. */
export function Notice({
  label,
  children,
  tone = "muted",
}: {
  label: string;
  children: ReactNode;
  tone?: "muted" | "warn";
}) {
  return (
    <div
      role="note"
      className={`flex gap-4 border-t border-hair pt-4 text-[13px] leading-normal ${tone === "warn" ? "text-warn" : "text-muted"}`}
    >
      <span className="shrink-0 font-mono text-[11px] tracking-wide">{label}</span>
      <span>{children}</span>
    </div>
  );
}
