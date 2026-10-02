import { browser } from "wxt/browser";
import { createRpcClient } from "@claviger/ui/rpc-client";

export const rpc = createRpcClient((message) => browser.runtime.sendMessage(message));
