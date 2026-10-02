import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { LockPolicy } from "../../src/background/settings";
import { VaultService } from "../../src/background/vaultService";
import { createRpcClient } from "../../src/rpc/client";
import { handleRpcMessage } from "../../src/rpc/server";
import { LocaleProvider, type Locale } from "../../src/ui/i18n/i18n";
import { UiProvider, type UiPlatform } from "../../src/ui/platform";
import { memoryPlatform } from "./platform";
import { PASSWORD } from "./service";

const CTX = { extensionId: "ext-id", extensionOrigin: "chrome-extension://ext-id/" };
const TAB_ID = 1;
const TRUSTED = { id: "ext-id", url: "chrome-extension://ext-id/popup.html" };

/** A UiPlatform wired to a real VaultService, so UI tests exercise real vault behaviour. */
export async function harness(
  opts: {
    status?: "no-vault" | "locked" | "unlocked";
    lockPolicy?: LockPolicy;
    tabUrl?: string;
    recoveryCode?: boolean;
    storageArea?: "local" | "sync";
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
    rpc: createRpcClient((message) => handleRpcMessage(service, message, TRUSTED, CTX)),
    isFirefox: false,
    copy: vi.fn(async (_text: string) => {}),
    openManage: vi.fn(),
    activeTab: vi.fn(async () => (opts.tabUrl ? { id: TAB_ID, url: opts.tabUrl } : undefined)),
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
