import { useState, type ReactNode } from "react";
import { QrImageTooLargeError } from "../contract/qrLimits";
import { useImagePaste } from "../components/useImagePaste";
import { AccountForm } from "../components/AccountForm";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { RpcError } from "../rpc/client";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";

function Option({
  num,
  title,
  hint,
  onClick,
  last,
}: {
  num: string;
  title: string;
  hint: string;
  onClick?: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex w-full cursor-pointer items-start gap-4 border-0 border-t border-hair bg-transparent py-4 text-left font-sans text-text disabled:cursor-not-allowed disabled:opacity-50 ${last ? "border-b" : ""}`}
    >
      <span className="pt-0.5 font-mono text-[11px] text-muted">{num}</span>
      <span className="flex flex-1 flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-medium">{title}</span>
        <span className="text-xs leading-normal text-muted">{hint}</span>
      </span>
      <Icon name="next" className="mt-0.5 shrink-0 text-muted" />
    </button>
  );
}

function Shell({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between pt-2 pr-7 pl-4">
        <button
          type="button"
          aria-label={t("common.back")}
          onClick={onBack}
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-text"
        >
          <Icon name="back" size={18} />
        </button>
        <div className="font-mono text-xs tracking-wide">{t("app.name")}</div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-7 pb-5">{children}</div>
    </div>
  );
}

export function AddAccount({
  tabUrl,
  tabDomain,
  onBack,
  onAdded,
}: {
  tabUrl?: string;
  tabDomain?: string | null;
  onBack: () => void;
  onAdded: (name: string) => void;
}) {
  const { openManage, captureTab, openScan, rpc, capabilities, imageToCapture } = useUi();
  const t = useT();
  const [manual, setManual] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  // Capture first, store second, open third: closing the popup drops anything held in it.
  async function scan() {
    setScanNote(null);
    try {
      const capture = await captureTab();
      if (!capture) {
        setScanNote(t("add.qrRestricted"));
        return;
      }
      const { id } = await rpc("storeCapture", capture);
      openScan(id);
    } catch (e) {
      setScanNote(
        e instanceof RpcError && e.code === "invalid-request"
          ? t("add.qrRestricted")
          : errorMessage(t, e),
      );
    }
  }

  async function fromImage(files: File[]) {
    setScanNote(null);
    try {
      // No tab URL: a pasted image says nothing about which site the account belongs to.
      const dataUrl = await imageToCapture!(files[0]!);
      const { id } = await rpc("storeCapture", { dataUrl, tabUrl: "" });
      openScan(id);
    } catch (e) {
      setScanNote(e instanceof QrImageTooLargeError ? t("add.imageTooLarge") : errorMessage(t, e));
    }
  }

  const canPaste = capabilities.qrScan && !!imageToCapture;
  useImagePaste((files) => void fromImage(files), canPaste && !manual);

  if (manual) {
    return (
      <Shell onBack={() => setManual(false)}>
        <h1 className="m-0 pt-5 pb-5 text-[22px] font-medium tracking-tight">
          {t("add.manualTitle")}
        </h1>
        <AccountForm tabUrl={tabUrl} tabDomain={tabDomain} onAdded={onAdded} />
      </Shell>
    );
  }

  return (
    <Shell onBack={onBack}>
      <div className="flex flex-col gap-2 pt-7">
        <h1 className="m-0 text-[28px] leading-tight font-medium tracking-tight">
          {t("add.title")}
        </h1>
        <p className="m-0 text-sm leading-normal text-muted">{t("add.body")}</p>
      </div>
      <div className="flex flex-col pt-7">
        {capabilities.qrScan ? (
          <div className="flex flex-col items-start gap-2 pb-6">
            <Button variant="primary" onClick={() => void scan()} className="w-full">
              {t("add.qr")}
            </Button>
            <p className="m-0 text-xs leading-normal text-muted">{t("add.qrHint")}</p>
            {canPaste ? (
              <p className="m-0 text-[11px] leading-normal text-muted">{t("add.pasteHint")}</p>
            ) : null}
          </div>
        ) : null}
        <Option
          num="01"
          title={t("add.manual")}
          hint={t("add.manualHint")}
          onClick={() => setManual(true)}
        />
        <Option
          num="02"
          title={t("add.import")}
          hint={t("add.importHint")}
          onClick={() => openManage("backup")}
          last
        />
      </div>
      <p role="alert" className="m-0 pt-3 text-xs leading-normal text-warn">
        {scanNote}
      </p>
      <p className="m-0 mt-auto pt-4 text-[11px] leading-normal text-muted">{t("add.footer")}</p>
    </Shell>
  );
}
