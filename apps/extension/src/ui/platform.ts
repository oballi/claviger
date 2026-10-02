import { createContext, useContext } from "react";
import type { RpcPayload, RpcResults, RpcType } from "../rpc/protocol";

export type Rpc = <T extends RpcType>(type: T, payload: RpcPayload<T>) => Promise<RpcResults[T]>;

export type ManageRoute = "setup" | "recover" | "accounts" | "security" | "backup" | "import";

/** Everything the UI needs from the browser; components never touch `browser.*` directly. */
export interface UiPlatform {
  rpc: Rpc;
  /** Firefox does not report screen locks; the lock-policy copy changes accordingly (spec §5.4). */
  isFirefox: boolean;
  copy(text: string): Promise<void>;
  openManage(route?: ManageRoute): void;
  /** The tab the popup was opened on; undefined on the manage page or when the tab has no URL. */
  activeTab(): Promise<{ id: number; url: string } | undefined>;
  /** Must be the first await in a click handler so the user gesture still holds. */
  requestClockPermission(): Promise<boolean>;
  removeClockPermission(): Promise<void>;
  fetchServerDate(): Promise<{ serverDate: string; startMs: number; endMs: number }>;
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
