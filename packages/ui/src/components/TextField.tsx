import type { InputHTMLAttributes } from "react";

export function TextField({
  id,
  label,
  hint,
  error,
  mono = false,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  mono?: boolean;
}) {
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        className={`h-11 min-w-0 border-0 border-b border-line bg-transparent px-0 text-text outline-none focus-visible:border-text ${mono ? "font-mono text-base tracking-wider" : "text-sm"}`}
        {...props}
      />
      {hint ? (
        <p id={`${id}-hint`} className="m-0 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="m-0 text-xs text-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
