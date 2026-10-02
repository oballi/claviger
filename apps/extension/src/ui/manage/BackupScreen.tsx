import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import type { ServiceState, StorageUsageView } from "../../background/vaultService";
import { QrImageTooLargeError } from "../../qr/limits";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { NewPasswordFields, newPasswordProblem } from "../components/NewPasswordFields";
import { ReauthForm } from "../components/ReauthForm";
import { formatDate, isoDate } from "../format";
import { useLocale, useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { PageTitle, SettingsRow, SettingsSection } from "./ManageFrame";
import { SnapshotsSection } from "./SnapshotsSection";

export const MAX_IMPORT_CHARS = 5_000_000;
const MAX_IMAGE_BYTES = 20_000_000;
const MAX_IMPORT_FILES = 20;
const OTP_TEXT = /^otpauth(-migration)?:/i;

function isImage(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

export interface ImportSource {
  text: string;
  name: string | null;
  /** Image files that held no 2FA QR; shown as a warning on the preview. */
  skippedImages?: string[];
}

const SOURCES = ["Google Authenticator", "Authenticator", "Aegis", "2FAS", "otp-vault"];

function Radio({
  name,
  checked,
  onSelect,
  title,
  hint,
  badge,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint: ReactNode;
  badge?: string;
}) {
  const id = useId();
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-4 border-t border-hair py-4">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-hint`}
        className="mt-1 h-4 w-4 accent-[var(--ov-text)]"
      />
      <span className="flex flex-col gap-1">
        <span id={`${id}-title`} className="flex items-center gap-2 text-[15px] font-medium">
          {title}
          {badge ? (
            <span className="rounded-full border border-line px-[7px] py-px font-mono text-[10px] font-normal text-muted">
              {badge}
            </span>
          ) : null}
        </span>
        <span id={`${id}-hint`} className="text-[13px] leading-normal text-muted">
          {hint}
        </span>
      </span>
    </label>
  );
}

/** Design board "Yönetim — yedekleme", plus the storage-area move (spec §7). */
export function BackupScreen({
  state,
  onChanged,
  onImport,
}: {
  state: ServiceState;
  onChanged: () => void;
  onImport: (source: ImportSource) => void;
}) {
  const { rpc, download, decodeQr } = useUi();
  const t = useT();
  const locale = useLocale();
  const [format, setFormat] = useState<"otpvault" | "otpauth">("otpvault");
  const [custom, setCustom] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportConfirm, setExportConfirm] = useState("");
  const [plainAck, setPlainAck] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [exportResult, setExportResult] = useState<{ count: number; skipped: number } | null>(null);
  const [pasted, setPasted] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [usage, setUsage] = useState<StorageUsageView | null>(null);
  const [moving, setMoving] = useState(false);
  const [message, setMessage] = useState("");

  const root = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<string | null>(null);

  // Closing a panel hides its button; focus would otherwise fall to <body>.
  useEffect(() => {
    if (moving || confirming || !focusAfter.current) return;
    root.current?.querySelector<HTMLElement>(`[data-action="${focusAfter.current}"]`)?.focus();
    focusAfter.current = null;
  }, [moving, confirming]);

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await rpc("storageUsage", {}));
    } catch {
      setUsage(null);
    }
  }, [rpc]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const customProblem = custom ? newPasswordProblem(t, exportPassword, exportConfirm) : null;
  const ready = format === "otpvault" ? !customProblem : plainAck;
  const filename = `otp-vault-${isoDate(Date.now())}.${format === "otpvault" ? "otpvault" : "txt"}`;
  const target = state.storageArea === "local" ? "sync" : "local";

  // Losing readiness (e.g. unticking the acknowledgement) must not strand the open panel.
  useEffect(() => {
    if (confirming && !ready) {
      focusAfter.current = "export";
      setConfirming(false);
    }
  }, [confirming, ready]);

  function resetPasswords() {
    setCustom(false);
    setExportPassword("");
    setExportConfirm("");
  }

  function chooseFormat(next: "otpvault" | "otpauth") {
    setFormat(next);
    setConfirming(false);
    setPlainAck(false);
    resetPasswords();
  }

  function readText(text: string, name: string | null, skippedImages: string[] = []) {
    setImportError(null);
    if (text.length > MAX_IMPORT_CHARS) setImportError(t("import.tooLarge"));
    else onImport({ text, name, ...(skippedImages.length > 0 ? { skippedImages } : {}) });
  }

  async function readFiles(files: File[]) {
    if (files.length === 0) return;
    setImportError(null);
    if (files.length > MAX_IMPORT_FILES) {
      setImportError(t("import.tooManyFiles"));
      return;
    }
    const skipped: string[] = [];
    const parts: string[] = [];
    let qrFound = false;
    let sawImage = false;
    for (const file of files) {
      if (isImage(file)) {
        sawImage = true;
        if (file.size > MAX_IMAGE_BYTES) {
          setImportError(t("import.imageTooLarge"));
          return;
        }
        let texts: string[];
        try {
          if (!decodeQr) throw new Error("QR decoding is not available here");
          texts = await decodeQr(file);
        } catch (e) {
          setImportError(
            e instanceof QrImageTooLargeError ? t("import.imageTooLarge") : t("import.unreadable"),
          );
          return;
        }
        if (texts.length > 0) qrFound = true;
        const usable = texts.filter((text) => OTP_TEXT.test(text));
        if (usable.length === 0) skipped.push(file.name);
        parts.push(...usable);
        continue;
      }
      if (file.size > MAX_IMPORT_CHARS) {
        setImportError(t("import.tooLarge"));
        return;
      }
      try {
        parts.push(await file.text());
      } catch {
        setImportError(t("import.unreadable"));
        return;
      }
    }
    if (parts.length === 0 && sawImage) {
      setImportError(qrFound ? t("import.qrNotOtp") : t("import.qrNone"));
      return;
    }
    readText(
      parts.join("\n"),
      files.length === 1 ? (files[0]?.name ?? null) : files.map((f) => f.name).join(", "),
      skipped,
    );
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void readFiles(Array.from(event.dataTransfer.files));
  }

  const status =
    state.lastBackupAt === null ? (
      <>
        <span className="text-warn">{t("backup.neverSentence")}</span>{" "}
        {state.accountCount ? t("backup.risk", { count: state.accountCount }) : null}
      </>
    ) : (
      t("backup.last", { date: formatDate(locale, state.lastBackupAt) })
    );

  const usageText = usage
    ? usage.quotaBytes
      ? t("backup.usageQuota", {
          used: (usage.bytes / 1024).toFixed(1),
          quota: Math.round(usage.quotaBytes / 1024),
          percent: Math.round((usage.bytes / usage.quotaBytes) * 100),
        })
      : t("backup.usage", { used: (usage.bytes / 1024).toFixed(1) })
    : "";

  return (
    <div ref={root} className="flex flex-col gap-12">
      <PageTitle title={t("backup.title")}>{status}</PageTitle>
      <p role="status" className="m-0 -my-6 min-h-4 text-sm">
        {message}
      </p>

      <SettingsSection num="01" title={t("backup.export")}>
        <fieldset className="m-0 flex flex-col border-0 p-0">
          <legend className="sr-only">{t("backup.format")}</legend>
          <Radio
            name="export-format"
            checked={format === "otpvault"}
            onSelect={() => chooseFormat("otpvault")}
            title={t("backup.encrypted")}
            hint={t("backup.encryptedHint")}
            badge={t("common.recommended")}
          />
          <Radio
            name="export-format"
            checked={format === "otpauth"}
            onSelect={() => chooseFormat("otpauth")}
            title={t("backup.plain")}
            hint={
              <>
                <span className="text-warn">{t("backup.plainWarning")}</span>{" "}
                {t("backup.plainHint")}
              </>
            }
          />
        </fieldset>

        <div className="flex max-w-md flex-col gap-5 border-t border-hair py-5">
          {format === "otpvault" ? (
            <>
              <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
                <legend className="sr-only">{t("backup.passwordChoice")}</legend>
                <label className="flex min-h-11 items-center gap-2.5 text-sm">
                  <input
                    type="radio"
                    name="export-password"
                    checked={!custom}
                    onChange={() => setCustom(false)}
                    className="h-4 w-4 accent-[var(--ov-text)]"
                  />
                  {t("backup.useVault")}
                </label>
                <label className="flex min-h-11 items-center gap-2.5 text-sm">
                  <input
                    type="radio"
                    name="export-password"
                    checked={custom}
                    onChange={() => setCustom(true)}
                    className="h-4 w-4 accent-[var(--ov-text)]"
                  />
                  {t("backup.useCustom")}
                </label>
              </fieldset>
              {custom ? (
                <NewPasswordFields
                  password={exportPassword}
                  confirm={exportConfirm}
                  onPassword={setExportPassword}
                  onConfirm={setExportConfirm}
                  error={exportConfirm && customProblem ? customProblem : null}
                  labels={{
                    password: t("backup.customPassword"),
                    confirm: t("backup.customConfirm"),
                  }}
                  idPrefix="export"
                />
              ) : null}
            </>
          ) : (
            <label className="flex min-h-11 items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={plainAck}
                onChange={(e) => setPlainAck(e.target.checked)}
                className="h-4 w-4 accent-[var(--ov-text)]"
              />
              {t("backup.plainAck")}
            </label>
          )}
        </div>

        <div className="flex flex-col gap-5 border-t border-hair py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="font-mono text-xs text-muted">{filename}</span>
            {confirming ? null : (
              <Button
                variant="primary"
                data-action="export"
                disabled={!ready}
                onClick={() => {
                  setMessage("");
                  setConfirming(true);
                }}
              >
                {t("backup.download")}
                <Icon name="download" size={15} />
              </Button>
            )}
          </div>
          {confirming && ready ? (
            <div className="flex max-w-md flex-col gap-3">
              <ReauthForm
                submitLabel={t("backup.downloadConfirm")}
                onConfirmed={async (token, password) => {
                  const file = await rpc(
                    "exportVault",
                    format === "otpvault"
                      ? { token, format, exportPassword: custom ? exportPassword : password }
                      : { token, format },
                  );
                  download(file.filename, file.content);
                  focusAfter.current = "export";
                  setConfirming(false);
                  setPlainAck(false);
                  resetPasswords();
                  setExportResult({ count: file.count, skipped: file.skipped });
                  setMessage(t("backup.done", { count: file.count }));
                  onChanged();
                }}
              />
              <div>
                <Button
                  onClick={() => {
                    focusAfter.current = "export";
                    setConfirming(false);
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : null}
          <p role="alert" className="m-0 min-h-4 text-sm text-warn">
            {exportResult && exportResult.skipped > 0
              ? t("backup.skipped", { skipped: exportResult.skipped })
              : ""}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection num="02" title={t("backup.import")}>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="mt-5 flex flex-wrap items-center justify-center gap-4 border border-dashed border-line px-6 py-10 text-sm text-muted"
        >
          <span>{t("backup.drop")}</span>
          <span>{t("backup.or")}</span>
          <label className="flex h-11 cursor-pointer items-center rounded-full border border-line px-4 text-[13px] text-text focus-within:ring-2 focus-within:ring-[var(--ov-text)]">
            {t("backup.chooseFile")}
            <input
              type="file"
              className="sr-only"
              multiple
              accept=".json,.txt,.2fas,.otpvault,application/json,text/plain,image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                const input = e.currentTarget;
                void readFiles(Array.from(input.files ?? [])).finally(() => {
                  input.value = "";
                });
              }}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 py-5">
          <span className="text-xs text-muted">{t("backup.sources")}</span>
          {SOURCES.map((s) => (
            <span
              key={s}
              className="rounded-full border border-line px-2.5 py-1 font-mono text-[11px] text-muted"
            >
              {s}
            </span>
          ))}
        </div>
        <details className="border-t border-hair py-4 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center text-muted">
            {t("backup.paste")}
          </summary>
          <form
            className="flex flex-col gap-3 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              readText(pasted, null);
            }}
          >
            <label htmlFor="import-text" className="text-xs text-muted">
              {t("backup.pasteLabel")}
            </label>
            <textarea
              id="import-text"
              rows={5}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              spellCheck={false}
              className="border border-line bg-transparent p-3 font-mono text-[13px] text-text"
            />
            <div>
              <Button type="submit" disabled={pasted.trim().length === 0}>
                {t("backup.preview")}
              </Button>
            </div>
          </form>
        </details>
        <p role="alert" className="m-0 min-h-4 text-sm text-warn">
          {importError}
        </p>
        <p className="m-0 border-t border-hair py-4 text-[13px] leading-normal text-muted">
          {t("backup.importNote")}
        </p>
      </SettingsSection>

      <SettingsSection num="03" title={t("backup.storage")}>
        <SettingsRow
          title={state.storageArea === "sync" ? t("storage.sync") : t("storage.local")}
          description={usageText}
          action={
            moving ? null : (
              <Button
                data-action="move"
                onClick={() => {
                  setMessage("");
                  setMoving(true);
                }}
              >
                {target === "sync" ? t("backup.toSync") : t("backup.toLocal")}
              </Button>
            )
          }
        >
          {moving ? (
            <>
              <p className="m-0 text-[13px] text-muted">
                {target === "sync" ? t("storage.syncHint") : t("storage.localHint")}
              </p>
              {target === "local" ? (
                <p className="m-0 text-[13px] text-warn">{t("backup.syncRemoval")}</p>
              ) : null}
              <ReauthForm
                submitLabel={t("backup.move")}
                errorKeys={{
                  "already-set-up": "error.target-has-vault",
                  "quota-exceeded": "error.move-quota",
                }}
                onConfirmed={async (token) => {
                  await rpc("setStorageArea", { token, area: target });
                  focusAfter.current = "move";
                  setMoving(false);
                  setMessage(t("backup.moved"));
                  onChanged();
                  await loadUsage();
                }}
              />
              <div>
                <Button
                  onClick={() => {
                    focusAfter.current = "move";
                    setMoving(false);
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SnapshotsSection num="04" onChanged={onChanged} />
    </div>
  );
}
