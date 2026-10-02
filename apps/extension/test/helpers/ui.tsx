import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { LockPolicy } from "../../src/background/settings";
import { VaultService } from "../../src/background/vaultService";
import { createRpcClient } from "../../src/rpc/client";
import { handleRpcMessage } from "../../src/rpc/server";
import { LocaleProvider, type Locale } from "../../src/ui/i18n/i18n";
import { UiProvider, type UiCapabilities, type UiPlatform } from "../../src/ui/platform";
import { memoryPlatform } from "./platform";
import { PASSWORD } from "./service";

const CTX = { extensionId: "ext-id", extensionOrigin: "chrome-extension://ext-id/" };
const TAB_ID = 1;
const SCAN_PAGE = { id: "ext-id", url: "chrome-extension://ext-id/scan.html#abc" };
const TRUSTED = { id: "ext-id", url: "chrome-extension://ext-id/popup.html" };

/** A UiPlatform wired to a real VaultService, so UI tests exercise real vault behaviour. */
export async function harness(
  opts: {
    status?: "no-vault" | "locked" | "unlocked";
    lockPolicy?: LockPolicy;
    tabUrl?: string;
    recoveryCode?: boolean;
    storageArea?: "local" | "sync";
    capabilities?: Partial<UiCapabilities>;
    reportsScreenLock?: boolean;
  } = {},
) {
  const p = memoryPlatform();
  p.tabs.activeTab = opts.tabUrl ? { id: TAB_ID, url: opts.tabUrl } : null;
  const service = new VaultService(p);
  const status = opts.status ?? "unlocked";
  let recoveryCode: string | null = null;
  if (status !== "no-vault") {
    ({ recoveryCode } = await service.setup({
      password: PASSWORD,
      createRecoveryCode: opts.recoveryCode ?? true,
      lockPolicy: opts.lockPolicy ?? { kind: "browser-close" },
      storageArea: opts.storageArea ?? "local",
    }));
    if (status === "locked") await service.lock();
  }
  const ui = {
    rpc: createRpcClient((message) =>
      handleRpcMessage(
        service,
        message,
        (message as { request?: { type?: string } }).request?.type === "takeCapture"
          ? SCAN_PAGE
          : TRUSTED,
        CTX,
      ),
    ),
    reportsScreenLock: opts.reportsScreenLock ?? true,
    capabilities: {
      activeTab: true,
      qrScan: true,
      autofill: true,
      clockCheck: true,
      storageArea: true,
      ...opts.capabilities,
    } satisfies UiCapabilities,
    copy: vi.fn(async (_text: string) => {}),
    openManage: vi.fn(),
    activeTab: vi.fn(async () => (opts.tabUrl ? { id: TAB_ID, url: opts.tabUrl } : undefined)),
    captureTab: vi.fn(async (): Promise<{ dataUrl: string; tabUrl: string } | null> => null),
    openScan: vi.fn((_id: string) => {}),
    requestClockPermission: vi.fn(async () => true),
    removeClockPermission: vi.fn(async () => {}),
    fetchServerDate: vi.fn(async () => {
      const now = p.clock.now();
      return { serverDate: new Date(now).toUTCString(), startMs: now, endMs: now };
    }),
    decodeQr: vi.fn(async (_image: Blob | ImageData): Promise<string[]> => []),
    download: vi.fn(),
    print: vi.fn(),
  } satisfies UiPlatform;
  return { p, service, ui, recoveryCode };
}

export type Harness = Awaited<ReturnType<typeof harness>>;

/** Wraps `getState` so a test can force a status the real service only reaches after corruption. */
export function withStatus(ui: UiPlatform, status: "unsupported" | "corrupt"): UiPlatform {
  const rpc: UiPlatform["rpc"] = async (type, payload) => {
    if (type === "getState") return { ...(await ui.rpc("getState", {})), status } as never;
    return ui.rpc(type, payload);
  };
  return { ...ui, rpc };
}

export function renderUi(node: ReactNode, ui: UiPlatform, locale: Locale = "tr") {
  return render(
    <UiProvider value={ui}>
      <LocaleProvider locale={locale}>{node}</LocaleProvider>
    </UiProvider>,
  );
}
