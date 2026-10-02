import { useT } from "../i18n/i18n";
import { Button } from "./Button";

export function StatusScreen({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col px-7 pt-[22px] pb-7">
      <div className="font-mono text-xs tracking-wide">{t("app.name")}</div>
      <div className="flex flex-1 flex-col justify-center gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="m-0 text-[28px] leading-tight font-medium tracking-tight">{title}</h1>
          <p className="m-0 text-sm leading-normal text-muted">{body}</p>
        </div>
        {actionLabel && onAction ? (
          <div>
            <Button variant="primary" onClick={onAction}>
              {actionLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
