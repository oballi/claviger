import { useEffect, useState } from "react";
import type { Theme } from "../contract/views";
import { Icon } from "../components/Icon";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { applyTheme } from "../theme";
import { iconButton } from "./iconButton";

export function resolvedScheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  // matchMedia is missing in some embedders (and jsdom).
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeToggle({
  theme,
  onError,
  onSaved,
}: {
  theme: Theme;
  onError: (message: string | null) => void;
  onSaved?: () => void;
}) {
  const { rpc } = useUi();
  const t = useT();
  const [current, setCurrent] = useState(theme);
  useEffect(() => setCurrent(theme), [theme]);
  const dark = resolvedScheme(current) === "dark";

  async function toggle() {
    const next: Theme = dark ? "light" : "dark";
    const previous = current;
    onError(null);
    setCurrent(next);
    applyTheme(next);
    try {
      await rpc("setTheme", { theme: next });
      onSaved?.();
    } catch (e) {
      setCurrent(previous);
      applyTheme(previous);
      onError(errorMessage(t, e));
    }
  }

  const label = t(dark ? "theme.switchToLight" : "theme.switchToDark");
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={iconButton}
      onClick={() => void toggle()}
    >
      <Icon name={dark ? "sun" : "moon"} size={17} />
    </button>
  );
}
