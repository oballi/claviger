import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ServiceState } from "../../background/vaultService";
import { QrImageTooLargeError } from "../../qr/limits";
import { RpcError } from "../../rpc/client";
import { Button } from "../components/Button";
import { LockScreen } from "../components/LockScreen";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { ImportScreen } from "../manage/ImportScreen";
import { useUi } from "../platform";
import { cropSelection, type Cropper } from "./crop";
import { dataUrlToBlob, otpauthName } from "./dataUrl";
import { defaultSelection, normalizeRect, nudgeSelection, type Rect, type Size } from "./selection";

const OTP_TEXT = /^otpauth(-migration)?:/i;
const MIGRATION = /^otpauth-migration:/i;
const NUDGE_PX = 10;
const MIN_DRAG_PX = 8;

type Phase =
  | { kind: "loading" }
  | { kind: "locked"; state: ServiceState }
  | { kind: "expired" }
  | { kind: "failed"; message: string }
  | { kind: "ready" };

interface Capture {
  dataUrl: string;
  tabUrl: string;
}

function Frame({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen justify-center bg-bg font-sans text-text">
      <div
        className={`flex w-full flex-col px-7 ${wide ? "max-w-[760px] py-10" : "max-w-[420px]"}`}
      >
        {children}
      </div>
    </div>
  );
}

export function ScanApp({
  captureId,
  crop = cropSelection,
}: {
  captureId: string;
  crop?: Cropper;
}) {
  const { rpc, decodeQr, openManage } = useUi();
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [capture, setCapture] = useState<Capture | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [bind, setBind] = useState(true);
  const [results, setResults] = useState<string[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sameName, setSameName] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState<string | null>(null);
  const [sel, setSel] = useState<Rect | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const started = useRef(false);

  const viewSize = (): Size => {
    const box = frameRef.current?.getBoundingClientRect();
    return { w: box?.width ?? 0, h: box?.height ?? 0 };
  };

  async function scan(image: () => Promise<Blob | ImageData> | Blob | ImageData, inCrop: boolean) {
    setScanning(true);
    setNotice(null);
    try {
      if (!decodeQr) throw new Error("QR decoding is not available here");
      const texts = await decodeQr(await image());
      const usable = texts.filter((text) => OTP_TEXT.test(text));
      if (usable.length > 0) {
        setResults(usable);
        return;
      }
      setResults(null);
      if (texts.length > 0) setNotice(t("import.qrNotOtp"));
      else if (inCrop) setNotice(t("scan.cropNone"));
    } catch (e) {
      setResults(null);
      setNotice(e instanceof QrImageTooLargeError ? t("import.imageTooLarge") : t("scan.failed"));
    } finally {
      setScanning(false);
    }
  }

  async function load() {
    try {
      const taken = await rpc("takeCapture", { id: captureId });
      setCapture(taken);
      setPhase({ kind: "ready" });
      rpc("listAccounts", { pageUrl: taken.tabUrl }).then(
        (list) => setDomain(list.pageDomain ?? null),
        () => {},
      );
      await scan(() => dataUrlToBlob(taken.dataUrl), false);
    } catch (e) {
      if (e instanceof RpcError && (e.code === "not-found" || e.code === "locked")) {
        setPhase({ kind: "expired" });
      } else {
        setPhase({ kind: "failed", message: errorMessage(t, e) });
      }
    }
  }

  async function begin() {
    try {
      const state = await rpc("getState", {});
      if (state.status === "locked") setPhase({ kind: "locked", state });
      else if (state.status === "unlocked") await load();
      else setPhase({ kind: "expired" });
    } catch (e) {
      setPhase({ kind: "failed", message: errorMessage(t, e) });
    }
  }

  // The capture is single-use: a second run (StrictMode) would find nothing.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void begin();
  }, []);

  const allAdded = results !== null && results.every((uri) => uri in added);
  useEffect(() => {
    if (allAdded) setCapture(null);
  }, [allAdded]);

  async function addOne(uri: string) {
    setError(null);
    try {
      const { name } = await rpc("addAccountUri", {
        uri,
        sourceUrl: domain && bind && capture ? capture.tabUrl : undefined,
        allowSameName: sameName === uri ? true : undefined,
      });
      setSameName(null);
      setAdded((prev) => ({ ...prev, [uri]: name || t("add.unnamed") }));
    } catch (e) {
      setSameName(e instanceof RpcError && e.code === "same-name" ? uri : null);
      setError(errorMessage(t, e));
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    anchor.current = { x: event.clientX - box.left, y: event.clientY - box.top };
    setSel(null);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already-released pointers cannot be captured; the drag still works.
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!anchor.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - box.left, y: event.clientY - box.top };
    setSel(normalizeRect(anchor.current, point, { w: box.width, h: box.height }));
  }

  function onPointerUp() {
    anchor.current = null;
    const size = viewSize();
    setSel((current) =>
      current && current.w >= MIN_DRAG_PX && current.h >= MIN_DRAG_PX
        ? current
        : defaultSelection(size),
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const dir: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = dir[event.key];
    if (!step) return;
    event.preventDefault();
    const size = viewSize();
    setSel(
      nudgeSelection(
        sel ?? defaultSelection(size),
        step[0] * NUDGE_PX,
        step[1] * NUDGE_PX,
        event.shiftKey,
        size,
      ),
    );
  }

  function scanSelection() {
    if (!capture) return;
    const size = viewSize();
    const box = sel ?? defaultSelection(size);
    void scan(() => crop(capture.dataUrl, box, size), true);
  }

  if (phase.kind === "locked") {
    return (
      <Frame>
        <LockScreen
          state={phase.state}
          onUnlocked={() => void load()}
          onForgot={() => openManage("recover")}
        />
      </Frame>
    );
  }

  let body: React.ReactNode;
  if (phase.kind === "loading") {
    body = <p className="m-0 text-sm text-muted">{t("common.loading")}</p>;
  } else if (phase.kind === "expired") {
    body = (
      <p role="alert" className="m-0 text-sm leading-normal text-warn">
        {t("scan.expired")}
      </p>
    );
  } else if (phase.kind === "failed") {
    body = (
      <p role="alert" className="m-0 text-sm text-warn">
        {phase.message}
      </p>
    );
  } else if (importing) {
    return (
      <Frame wide>
        <ImportScreen
          source={{ text: importing, name: t("scan.sourceName") }}
          onDone={() => {
            setAdded((prev) => ({ ...prev, [importing]: t("scan.sourceName") }));
            setImporting(null);
          }}
          onCancel={() => setImporting(null)}
        />
      </Frame>
    );
  } else if (allAdded) {
    body = (
      <p role="status" className="m-0 text-sm leading-normal">
        {t("scan.done")}
      </p>
    );
  } else {
    const picking = results === null;
    const found = results ?? [];
    body = (
      <>
        {capture ? (
          <div
            ref={frameRef}
            role="group"
            tabIndex={picking ? 0 : undefined}
            aria-label={t("scan.frame")}
            aria-describedby="scan-hint"
            onPointerDown={picking ? onPointerDown : undefined}
            onPointerMove={picking ? onPointerMove : undefined}
            onPointerUp={picking ? onPointerUp : undefined}
            onKeyDown={picking ? onKeyDown : undefined}
            className={`relative max-w-full self-start overflow-hidden border border-hair outline-none select-none focus-visible:border-text ${picking ? "cursor-crosshair touch-none" : ""}`}
          >
            <img
              src={capture.dataUrl}
              alt={t("scan.imageAlt")}
              draggable={false}
              onLoad={() => {
                if (picking) setSel((current) => current ?? defaultSelection(viewSize()));
              }}
              className="block h-auto max-w-full"
            />
            {picking && sel ? (
              <div
                data-testid="scan-selection"
                aria-hidden="true"
                className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }}
              />
            ) : null}
          </div>
        ) : null}
        <p role="status" className="m-0 min-h-4 text-sm text-warn">
          {scanning ? t("scan.scanning") : notice}
        </p>
        {error ? (
          <p role="alert" className="m-0 text-sm text-warn">
            {error}
          </p>
        ) : null}
        {picking ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h2 className="m-0 text-[22px] font-medium tracking-tight">{t("scan.draw")}</h2>
              <p id="scan-hint" className="m-0 text-sm leading-normal text-muted">
                {t("scan.drawHint")}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" disabled={scanning} onClick={scanSelection}>
                {t("scan.scanSelection")}
              </Button>
              <Button
                disabled={scanning || !capture}
                onClick={() => capture && void scan(() => dataUrlToBlob(capture.dataUrl), false)}
              >
                {t("scan.rescanAll")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {found.length > 1 ? (
              <h2 className="m-0 text-[22px] font-medium tracking-tight">
                {t("scan.found", { count: found.length })}
              </h2>
            ) : (
              <h2 className="m-0 text-[22px] font-medium tracking-tight">{t("scan.foundOne")}</h2>
            )}
            {domain ? (
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={bind}
                  onChange={(e) => setBind(e.target.checked)}
                  className="h-4 w-4 accent-[var(--ov-text)]"
                />
                {t("add.bind", { domain })}
              </label>
            ) : null}
            <ul className="m-0 flex list-none flex-col border-b border-hair p-0">
              {found.map((uri) => {
                const migration = MIGRATION.test(uri);
                const done = added[uri];
                const name = migration ? t("scan.migrationName") : otpauthName(uri);
                return (
                  <li
                    key={uri}
                    className="flex min-h-14 items-center justify-between gap-4 border-t border-hair py-2"
                  >
                    <span className="min-w-0 truncate text-[15px]">{name || t("add.unnamed")}</span>
                    {done ? (
                      <span role="status" className="text-xs text-muted">
                        {t("scan.added", { name: done })}
                      </span>
                    ) : migration ? (
                      <Button onClick={() => setImporting(uri)}>{t("scan.preview")}</Button>
                    ) : (
                      <Button variant="primary" onClick={() => void addOne(uri)}>
                        {sameName === uri ? t("add.saveAnyway") : t("scan.add")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div>
              <Button
                onClick={() => {
                  setResults(null);
                  setSel(null);
                }}
              >
                {t("scan.selectArea")}
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <Frame wide>
      <header className="flex items-center justify-between pb-8">
        <div className="font-mono text-xs tracking-wide">{t("app.name")}</div>
      </header>
      <div className="flex flex-col gap-5">
        <h1 className="m-0 text-[28px] leading-tight font-medium tracking-tight">
          {t("scan.title")}
        </h1>
        {body}
      </div>
    </Frame>
  );
}
