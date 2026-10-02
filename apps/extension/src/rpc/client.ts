import { RPC_CHANNEL } from "./channel";
import type { RpcPayload, RpcResponse, RpcResults, RpcType } from "./protocol";

export class RpcError extends Error {
  readonly code: string;
  readonly retryAfterMs?: number;

  constructor(code: string, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

export type RpcSend = (message: unknown) => Promise<unknown>;

export function createRpcClient(send: RpcSend) {
  return async function call<T extends RpcType>(
    type: T,
    payload: RpcPayload<T>,
  ): Promise<RpcResults[T]> {
    const response = (await send({ channel: RPC_CHANNEL, request: { ...payload, type } })) as
      RpcResponse<RpcResults[T]> | undefined;
    if (!response) throw new RpcError("no-response", "The background service did not respond");
    if (!response.ok) {
      throw new RpcError(response.error.code, response.error.message, response.error.retryAfterMs);
    }
    return response.data;
  };
}
