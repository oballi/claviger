import { describe, expect, it } from "vitest";
import { RPC_CHANNEL } from "../src/rpc/channel";
import { createRpcClient, RpcError } from "../src/rpc/client";

describe("createRpcClient", () => {
  it("wraps the payload in an envelope and returns the data", async () => {
    const seen: unknown[] = [];
    const call = createRpcClient(async (message) => {
      seen.push(message);
      return { ok: true, data: { code: "123456" } };
    });
    await expect(call("nextHotp", { id: "a" })).resolves.toEqual({ code: "123456" });
    expect(seen[0]).toEqual({ channel: RPC_CHANNEL, request: { id: "a", type: "nextHotp" } });
  });

  it("turns an error response into an RpcError with the retry delay", async () => {
    const call = createRpcClient(async () => ({
      ok: false,
      error: { code: "wrong-password", message: "nope", retryAfterMs: 2000 },
    }));
    const error = await call("unlock", { password: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: "wrong-password", retryAfterMs: 2000 });
  });

  it("reports a missing response", async () => {
    const call = createRpcClient(async () => undefined);
    await expect(call("lock", {})).rejects.toMatchObject({ code: "no-response" });
  });
});
