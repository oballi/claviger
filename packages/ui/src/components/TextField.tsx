import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { useT } from "../i18n/i18n";
import { Icon } from "./Icon";

/** Eye button that toggles a password input between hidden and visible. */
export function PasswordEye({
  shown,
  onToggle,
  className = "",
}: {
  shown: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      aria-label={t("password.show")}
      className={`inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-text ${className}`}
    >
      <Icon name={shown ? "eye-off" : "eye"} />
    </button>
  );
}

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
  const [shown, setShown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // A revealed password must not stay on screen after the form was submitted.
    const form = inputRef.current?.form;
    const hide = () => setShown(false);
    form?.addEventListener("submit", hide);
    return () => form?.removeEventListener("submit", hide);
  }, []);
  const isPassword = props.type === "password";
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <div className="relative flex items-center">
        <input
          id={id}
          ref={inputRef}
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          className={`h-11 min-w-0 flex-1 border-0 border-b border-line bg-transparent ${isPassword ? "pl-0 pr-11" : "px-0"} text-text outline-none focus-visible:border-text ${mono ? "font-mono text-base tracking-wider" : "text-sm"}`}
          {...props}
          type={isPassword && shown ? "text" : props.type}
          {...(isPassword ? { spellCheck: false, autoCorrect: "off", autoCapitalize: "off" } : {})}
        />
        {isPassword ? (
          <PasswordEye
            shown={shown}
            onToggle={() => setShown(!shown)}
            className="absolute right-0"
          />
        ) : null}
      </div>
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
