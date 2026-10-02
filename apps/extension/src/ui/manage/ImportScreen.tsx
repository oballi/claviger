import type { ImportFormat } from "@otp-vault/core";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ImportPreviewView } from "../../background/vaultService";
import { RpcError } from "../../rpc/client";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { TextField } from "../components/TextField";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { typeLabel } from "../format";
import { useUi } from "../platform";
import type { ImportSource } from "./BackupScreen";

type Preview = Extract<ImportPreviewView, { status: "ok" }>;
type Stage =
  | { kind: "loading" }
  | { kind: "password"; format: ImportFormat }
  | { kind: "preview"; preview: Preview; selected: Set<number>; decrypted: boolean }
  | { kind: "failed" }
  | { kind: "result"; added: number; duplicates: number };

/** Design board "Yönetim — içe aktarma önizlemesi": nothing is saved until the user confirms. */
export function ImportScreen({
  source,
  onDone,
  embedded,
  doneLabel,
  onCancel,
}: {
  source: ImportSource;
  onDone: () => void;
  /** Scan tab: no manage breadcrumb, and the final button gets its own label. */
  embedded?: boolean;
  doneLabel?: string;
  onCancel: () => void;
}) {
  const { rpc } = useUi();
  const t = useT();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useCallback(
    async (filePassword?: string, guard: { ignore: boolean } = { ignore: false }) => {
      setBusy(true);
      setError(null);
      try {
        const result = await rpc(
          "importPreview",
          filePassword === undefined
            ? { text: source.text }
            : { text: source.text, password: filePassword },
        );
        if (guard.ignore) return;
        if (result.status === "unrecognized") {
          setError(t("import.unrecognized"));
          setStage({ kind: "failed" });
        } else if (result.status === "needs-password") {
          setStage({ kind: "password", format: result.format });
        } else {
          setPassword("");
          setStage({
            kind: "preview",
            preview: result,
            selected: new Set(result.items.filter((i) => i.status === "new").map((i) => i.index)),
            decrypted: filePassword !== undefined,
          });
        }
      } catch (e) {
        if (guard.ignore) return;
        setError(errorMessage(t, e));
        setPassword("");
        setStage((s) => (s.kind === "password" ? s : { kind: "failed" }));
      } finally {
        if (!guard.ignore) setBusy(false);
      }
    },
    [rpc, source.text, t],
  );

  // A slow response for a replaced source must not overwrite the newer preview.
  useEffect(() => {
    const guard = { ignore: false };
    void preview(undefined, guard);
    return () => {
      guard.ignore = true;
    };
  }, [preview]);

  async function commit(current: Extract<Stage, { kind: "preview" }>) {
    setBusy(true);
    setError(null);
    try {
      const result = await rpc("importCommit", {
        previewId: current.preview.previewId,
        indexes: [...current.selected],
      });
      setStage({ kind: "result", ...result });
    } catch (e) {
      if (e instanceof RpcError && e.code === "preview-expired") setStage({ kind: "failed" });
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  function toggle(current: Extract<Stage, { kind: "preview" }>, index: number) {
    const selected = new Set(current.selected);
    if (selected.has(index)) selected.delete(index);
    else selected.add(index);
    setStage({ ...current, selected });
  }

  const fileName = source.name ?? t("import.pasted");
  const formatName = (f: ImportFormat) => t(`format.${f}`);

  let body;
  if (stage.kind === "loading") {
    body = <p className="m-0 text-sm text-muted">{t("common.loading")}</p>;
  } else if (stage.kind === "password") {
    body = (
      <form
        className="flex max-w-md flex-col gap-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void preview(password);
        }}
      >
        <p className="m-0 text-[15px]">
          {t("import.passwordNeeded", { format: formatName(stage.format) })}
        </p>
        <TextField
          id="import-password"
          type="password"
          autoComplete="off"
          label={t("import.password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
          autoFocus
          mono
        />
        <div>
          <Button type="submit" variant="primary" disabled={busy || password.length === 0}>
            {t("import.open")}
          </Button>
        </div>
      </form>
    );
  } else if (stage.kind === "result") {
    body = (
      <div className="flex flex-col items-start gap-6">
        <p role="status" className="m-0 text-[15px]">
          {t("import.result", { added: stage.added, duplicates: stage.duplicates })}
        </p>
        <Button variant="primary" onClick={onDone}>
          {doneLabel ?? t("import.toAccounts")}
        </Button>
      </div>
    );
  } else if (stage.kind === "failed") {
    body = null;
  } else {
    const { preview: p, selected } = stage;
    const counts = [
      [p.items.filter((i) => i.status === "new").length, t("import.count.new")],
      [p.items.filter((i) => i.status === "duplicate").length, t("import.count.duplicate")],
      [p.issues.length, t("import.count.issue")],
    ] as const;
    body = (
      <>
        {source.skippedImages?.length ? (
          <p role="status" className="m-0 text-sm text-warn">
            {t("backup.qrSkipped", {
              count: source.skippedImages.length,
              names: source.skippedImages.join(", "),
            })}
          </p>
        ) : null}
        <dl className="m-0 grid grid-cols-3 border-y border-hair">
          {counts.map(([count, label], i) => (
            <div
              key={label}
              className={`flex flex-col-reverse gap-1 py-5 ${i ? "border-l border-hair pl-6" : ""}`}
            >
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="m-0 font-mono text-2xl">{count}</dd>
            </div>
          ))}
        </dl>
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{t("import.table")}</caption>
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th scope="col" className="w-12 pb-2.5 font-normal">
                <span className="sr-only">{t("import.col.select")}</span>
              </th>
              <th scope="col" className="pb-2.5 font-normal">
                {t("add.issuer")}
              </th>
              <th scope="col" className="pb-2.5 font-normal">
                {t("add.label")}
              </th>
              <th scope="col" className="pb-2.5 font-normal">
                {t("add.type")}
              </th>
              <th scope="col" className="pb-2.5 font-normal">
                {t("import.col.status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {p.items.map((item) => {
              const duplicate = item.status === "duplicate";
              const name =
                item.issuer && item.label
                  ? `${item.issuer} (${item.label})`
                  : item.issuer || item.label;
              return (
                <tr
                  key={`i${item.index}`}
                  className={`h-14 border-b border-hair ${duplicate ? "text-muted" : ""}`}
                >
                  <td>
                    <label className="flex h-11 w-11 cursor-pointer items-center">
                      <input
                        type="checkbox"
                        aria-label={t("import.select", { name })}
                        disabled={duplicate}
                        checked={selected.has(item.index)}
                        onChange={() => toggle(stage, item.index)}
                        className="h-4 w-4 accent-[var(--ov-text)]"
                      />
                    </label>
                  </td>
                  <td className="pr-4">{item.issuer}</td>
                  <td className="pr-4">{item.label}</td>
                  <td className="pr-4 font-mono text-xs">{typeLabel(item.type)}</td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 rounded-full border border-current ${duplicate ? "" : "bg-current"}`}
                      />
                      {duplicate ? t("import.status.duplicate") : t("import.status.new")}
                    </span>
                  </td>
                </tr>
              );
            })}
            {p.issues.map((issue) => (
              <tr key={`x${issue.position}`} className="h-14 border-b border-hair text-muted">
                <td>
                  <input
                    type="checkbox"
                    disabled
                    aria-label={t("import.select", {
                      name: issue.name || `#${issue.position + 1}`,
                    })}
                    className="h-4 w-4"
                  />
                </td>
                <td className="pr-4">{issue.name || `#${issue.position + 1}`}</td>
                <td className="pr-4" />
                <td className="pr-4" />
                <td className="text-warn">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                    {t(`import.issue.${issue.reason}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="text-[13px] text-muted">{t("import.duplicatesNote")}</span>
          <Button
            variant="primary"
            disabled={busy || selected.size === 0}
            onClick={() => void commit(stage)}
          >
            {t("import.commit", { count: selected.size })}
            <Icon name="arrow" size={15} />
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {embedded ? null : (
        <nav
          aria-label={t("import.breadcrumb")}
          className="flex items-center gap-2 font-mono text-xs text-muted"
        >
          <a href="#/accounts" className="text-text">
            {t("app.name")}
          </a>
          <span aria-hidden="true">/</span>
          <span>{t("import.crumb")}</span>
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-3">
          <h1 className="m-0 text-[44px] leading-none font-medium tracking-tight">
            {t("import.title")}
          </h1>
          <p className="m-0 text-[15px] text-muted">
            <span className="font-mono text-text">{fileName}</span>
            {stage.kind === "preview" ? ` · ${formatName(stage.preview.format)}` : ""}
            {stage.kind === "preview" && stage.decrypted ? ` · ${t("import.decrypted")}` : ""}
          </p>
        </div>
        {stage.kind === "result" ? null : <Button onClick={onCancel}>{t("import.another")}</Button>}
      </div>
      {stage.kind === "password" ? null : (
        <p role="alert" className="m-0 min-h-4 text-sm text-warn">
          {error}
        </p>
      )}
      {body}
    </div>
  );
}
