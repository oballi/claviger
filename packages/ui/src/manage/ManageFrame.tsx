import { useState, type ReactNode, type Ref } from "react";
import type { Theme } from "../contract/views";
import { Icon } from "../components/Icon";
import { useT } from "../i18n/i18n";
import type { ManageRoute } from "../platform";
import { ThemeToggle } from "../popup/ThemeToggle";

const SECTIONS = [
  { route: "accounts", key: "manage.nav.accounts" },
  { route: "preferences", key: "manage.nav.preferences" },
  { route: "security", key: "manage.nav.security" },
  { route: "backup", key: "manage.nav.backup" },
] as const;

/** Signed-in manage layout: logo, section nav and a lock button (design boards Vault/Security/Backup). */
export function ManageFrame({
  active,
  onLock,
  theme,
  onThemeSaved,
  wide = false,
  children,
}: {
  active: ManageRoute | null;
  wide?: boolean;
  onLock?: () => void;
  /** Stored theme; the header toggle shows up when it is known. */
  theme?: Theme;
  onThemeSaved?: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const [themeError, setThemeError] = useState<string | null>(null);
  return (
    <div className="min-h-screen bg-bg px-[clamp(20px,5vw,72px)] pt-7 pb-14 font-sans text-text">
      <div
        className={`mx-auto flex w-full ${wide ? "max-w-[1240px]" : "max-w-[1040px]"} flex-col gap-12`}
      >
        <header className="flex flex-wrap items-center gap-x-10 gap-y-4 border-b border-hair pb-3.5">
          <div className="font-mono text-[13px] tracking-wide max-[640px]:flex-1">
            {t("app.name")}
          </div>
          {onLock ? (
            <>
              <nav
                aria-label={t("manage.nav.label")}
                className="order-3 flex w-full gap-7 overflow-x-auto text-sm whitespace-nowrap min-[641px]:order-2 min-[641px]:w-auto min-[641px]:flex-1"
              >
                {SECTIONS.map((s) => (
                  <a
                    key={s.route}
                    href={`#/${s.route}`}
                    aria-current={active === s.route ? "page" : undefined}
                    className={`flex min-h-11 shrink-0 items-center ${active === s.route ? "text-text underline decoration-1 underline-offset-8" : "text-muted no-underline"}`}
                  >
                    {t(s.key)}
                  </a>
                ))}
              </nav>
              <div className="order-2 flex items-center gap-2 min-[641px]:order-3">
                {theme ? (
                  <ThemeToggle theme={theme} onError={setThemeError} onSaved={onThemeSaved} />
                ) : null}
                <button
                  type="button"
                  onClick={onLock}
                  className="flex h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-transparent px-4 font-sans text-[13px] text-text"
                >
                  <Icon name="lock" size={14} />
                  {t("manage.lock")}
                </button>
              </div>
            </>
          ) : null}
        </header>
        {themeError ? (
          <p role="alert" className="m-0 -my-6 text-sm text-warn">
            {themeError}
          </p>
        ) : null}
        <main>{children}</main>
      </div>
    </div>
  );
}

/** Page heading with the design's trailing-period style and an optional mono count. */
export function PageTitle({
  title,
  count,
  headingRef,
  children,
}: {
  title: string;
  count?: number;
  headingRef?: Ref<HTMLHeadingElement>;
  children?: ReactNode;
}) {
  return (
    <div className="flex max-w-[640px] flex-col gap-3">
      <div className="flex items-baseline gap-4">
        <h1
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className="m-0 text-[44px] leading-none font-medium tracking-tight outline-none"
        >
          {title}
        </h1>
        {count !== undefined ? <span className="font-mono text-sm text-muted">{count}</span> : null}
      </div>
      {children ? <div className="text-[15px] leading-relaxed text-muted">{children}</div> : null}
    </div>
  );
}

/** A numbered settings section: "01  Erişim" on the left, rows on the right. */
export function SettingsSection({
  num,
  title,
  children,
}: {
  num: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-wrap gap-x-20 gap-y-4">
      <div className="flex max-w-60 flex-[1_1_200px] gap-3.5 pt-[22px]">
        <span className="pt-[3px] font-mono text-[11px] text-muted">{num}</span>
        <h2 className="m-0 text-[15px] font-medium">{title}</h2>
      </div>
      <div className="flex flex-[999_1_480px] flex-col border-t border-text">{children}</div>
    </section>
  );
}

/** One settings row: title and description, an action on the right, an optional panel below. */
export function SettingsRow({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 border-b border-hair py-[22px]">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-3">
        <div className="flex flex-[1_1_320px] flex-col gap-1">
          <div className="text-[15px] font-medium">{title}</div>
          <div className="text-[13px] leading-normal text-muted">{description}</div>
        </div>
        {action ? <div className="flex items-center gap-4">{action}</div> : null}
      </div>
      {children ? <div className="flex max-w-md flex-col gap-5">{children}</div> : null}
    </div>
  );
}
