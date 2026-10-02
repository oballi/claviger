import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { encodeBinaryImport } from "@claviger/core";
import type { ServiceState, StorageUsageView } from "../contract/views";
import { MAX_IMAGE_BYTES, QrImageTooLargeError } from "../contract/qrLimits";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { useImagePaste } from "../components/useImagePaste";
import { NewPasswordFields, newPasswordProblem } from "../components/NewPasswordFields";
import { ReauthForm } from "../components/ReauthForm";
import { formatDate, isoDate } from "../format";
import { useLocale, useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { PageTitle, SettingsRow, SettingsSection } from "./ManageFrame";
import { PhoneTransfer } from "./PhoneTransfer";
import { SnapshotsSection } from "./SnapshotsSection";

export const MAX_IMPORT_CHARS = 5_000_000;
// Base64 inflates by 4/3; keeps the transport text under MAX_IMPORT_CHARS.
const MAX_BINARY_BYTES = 3_700_000;
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

const SOURCES = [
  "Google Authenticator",
  "Authenticator",
  "Aegis",
  "2FAS",
  "Proton",
  "Bitwarden",
  "andOTP",
  "FreeOTP+",
  "Stratum",
  "Raivo",
  "claviger",
];

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

type ExportFormat = "claviger" | "otpauth" | "aegis" | "aegis-plain";

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 mb-2 mt-5 font-mono text-[11px] uppercase tracking-wider text-muted first:mt-0">
      {children}
    </p>
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
  const { rpc, download, decodeQr, capabilities } = useUi();
  const t = useT();
  const locale = useLocale();
  const [format, setFormat] = useState<ExportFormat>("claviger");
  const [custom, setCustom] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportConfirm, setExportConfirm] = useState("");
  const [plainAck, setPlainAck] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [exportResult, setExportResult] = useState<{ count: number; skipped: number } | null>(null);
  const [pasted, setPasted] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [usage, setUsage] = useState<StorageUsageView | null>(null);
  const [moving, setMoving] = useState(false);
  const [message, setMessage] = useState("");
  const [transferring, setTransferring] = useState(false);

  const root = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<string | null>(null);

  // Closing a panel hides its button; focus would otherwise fall to <body>.
  useEffect(() => {
    if (moving || confirming || transferring || !focusAfter.current) return;
    root.current?.querySelector<HTMLElement>(`[data-action="${focusAfter.current}"]`)?.focus();
    focusAfter.current = null;
  }, [moving, confirming, transferring]);

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

  const encrypted = format === "claviger" || format === "aegis";
  // Aegis uses scrypt N=2^15, weaker than the vault's Argon2id, so it never reuses the vault password.
  const useCustom = format === "aegis" || custom;
  const customProblem = useCustom ? newPasswordProblem(t, exportPassword, exportConfirm) : null;
  const ready = encrypted ? !customProblem : plainAck;
  const extension = {
    claviger: "claviger",
    otpauth: "txt",
    aegis: "aegis.json",
    "aegis-plain": "aegis.json",
  }[format];
  const filename = `claviger-${isoDate(Date.now())}.${extension}`;
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

  function chooseFormat(next: ExportFormat) {
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
        const bytes = new Uint8Array(await file.arrayBuffer());
        let text: string | null = null;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          text = null;
        }
        if (text === null) {
          // Binary backups (andOTP) travel as base64 text and must be chosen alone.
          if (files.length > 1) {
            setImportError(t("import.binarySingle"));
            return;
          }
          if (bytes.length > MAX_BINARY_BYTES) {
            setImportError(t("import.tooLarge"));
            return;
          }
          parts.push(encodeBinaryImport(bytes));
        } else parts.push(text);
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
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    // Dragging an image from a web page yields a URL, not a file; we have no network access to fetch it.
    if (files.length === 0) setImportError(t("backup.dropNoFile"));
    else void readFiles(files);
  }

  useImagePaste((files) => void readFiles(files));

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
          <GroupLabel>{t("backup.groupEncrypted")}</GroupLabel>
          <Radio
            name="export-format"
            checked={format === "claviger"}
            onSelect={() => chooseFormat("claviger")}
            title={t("backup.encrypted")}
            hint={t("backup.encryptedHint")}
            badge={t("common.recommended")}
          />
          <Radio
            name="export-format"
            checked={format === "aegis"}
            onSelect={() => chooseFormat("aegis")}
            title={t("backup.aegis")}
            hint={t("backup.aegisHint")}
          />
          <GroupLabel>{t("backup.groupPlain")}</GroupLabel>
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
          <Radio
            name="export-format"
            checked={format === "aegis-plain"}
            onSelect={() => chooseFormat("aegis-plain")}
            title={t("backup.aegisPlain")}
            hint={
              <>
                <span className="text-warn">{t("backup.plainWarning")}</span>{" "}
                {t("backup.aegisPlainHint")}
              </>
            }
          />
        </fieldset>

        <div className="flex max-w-md flex-col gap-5 border-t border-hair py-5">
          {encrypted ? (
            <>
              {format === "claviger" ? (
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
              ) : null}
              {useCustom ? (
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
                errorKeys={{ "invalid-request": "backup.samePassword" }}
                onConfirmed={async (token, password) => {
                  const file = await rpc(
                    "exportVault",
                    encrypted
                      ? { token, format, exportPassword: useCustom ? exportPassword : password }
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
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mt-5 flex flex-wrap items-center justify-center gap-4 border border-dashed px-6 py-10 text-sm text-muted ${dragging ? "border-text bg-hair" : "border-line"}`}
        >
          <span>{t("backup.drop")}</span>
          <span>{t("backup.or")}</span>
          <label className="flex h-11 cursor-pointer items-center rounded-full border border-line px-4 text-[13px] text-text focus-within:ring-2 focus-within:ring-[var(--ov-text)]">
            {t("backup.chooseFile")}
            <input
              type="file"
              className="sr-only"
              multiple
              // .otpvault: files written by earlier previews
              accept=".json,.txt,.2fas,.claviger,.otpvault,.aes,.bin,application/json,text/plain,image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                const input = e.currentTarget;
                void readFiles(Array.from(input.files ?? [])).finally(() => {
                  input.value = "";
                });
              }}
            />
          </label>
          <span className="basis-full text-center text-xs">{t("backup.pasteImageHint")}</span>
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

      <SettingsSection num="03" title={t("transfer.title")}>
        <SettingsRow
          title="Google Authenticator"
          description={t("transfer.hint")}
          action={
            transferring ? null : (
              <Button
                data-action="transfer"
                onClick={() => {
                  setMessage("");
                  setTransferring(true);
                }}
              >
                {t("transfer.choose")}
              </Button>
            )
          }
        >
          {transferring ? (
            <PhoneTransfer
              onClose={() => {
                focusAfter.current = "transfer";
                setTransferring(false);
              }}
            />
          ) : null}
        </SettingsRow>
      </SettingsSection>

      {capabilities.storageArea ? (
        <SettingsSection num="04" title={t("backup.storage")}>
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
      ) : null}

      <SnapshotsSection num={capabilities.storageArea ? "05" : "04"} onChanged={onChanged} />
    </div>
  );
}
