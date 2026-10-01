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
  activeTabUrl(): Promise<string | undefined>;
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
