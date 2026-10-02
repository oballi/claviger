import { createContext, useContext } from "react";
import type { RpcPayload, RpcResults, RpcType } from "@otp-vault/ui/protocol";

export type Rpc = <T extends RpcType>(type: T, payload: RpcPayload<T>) => Promise<RpcResults[T]>;

export type ManageRoute = "setup" | "recover" | "accounts" | "security" | "backup" | "import";

export interface UiCapabilities {
  /** The platform knows which page the user is on ("This site" ordering, fill target). */
  activeTab: boolean;
  /** The popup can capture the visible tab and open the QR scan page. */
  qrScan: boolean;
  /** The platform can type a code into the page (`fillCode`). */
  autofill: boolean;
  /** The platform may ask for a network permission and read a server clock. */
  clockCheck: boolean;
  /** The vault can live in a synced storage area besides local. */
  storageArea: boolean;
}

/** Everything the UI needs from the browser; components never touch `browser.*` directly. */
export interface UiPlatform {
  rpc: Rpc;
  /** Whether the platform reports screen locks; the lock-policy copy changes accordingly. */
  reportsScreenLock: boolean;
  capabilities: UiCapabilities;
  copy(text: string): Promise<void>;
  openManage(route?: ManageRoute): void;
  /** The tab the popup was opened on; undefined on the manage page or when the tab has no URL. */
  activeTab(): Promise<{ id: number; url: string } | undefined>;
  /** Popup only: grabs the visible tab right after the user's click; null on restricted pages and elsewhere. */
  captureTab(): Promise<{ dataUrl: string; tabUrl: string } | null>;
  /** Opens the scan page for a stored capture in a new tab. */
  openScan(id: string): void;
  /** Must be the first await in a click handler so the user gesture still holds. */
  requestClockPermission(): Promise<boolean>;
  removeClockPermission(): Promise<void>;
  fetchServerDate(): Promise<{ serverDate: string; startMs: number; endMs: number }>;
  /** Only the manage page provides it; rejects with QrImageTooLargeError for oversized images. */
  decodeQr?(image: Blob | ImageData): Promise<string[]>;
  download(filename: string, content: string): void;
  print(): void;
}

const UiContext = createContext<UiPlatform | null>(null);

export const UiProvider = UiContext.Provider;

export function useUi(): UiPlatform {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("UiProvider is missing");
  return ui;
}
