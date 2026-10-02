import { describe, expect, it } from "vitest";
import { handleRpcMessage } from "../src/rpc/server";
import { RPC_CHANNEL } from "@otp-vault/ui/protocol";
import { codeOf, unlockedService } from "./helpers/service";

const CAPTURE = { dataUrl: "data:image/png;base64,AAAA", tabUrl: "https://github.com/settings" };
const CTX = { extensionId: "ext-id", extensionOrigin: "chrome-extension://ext-id/" };
const TRUSTED = { id: "ext-id", url: "chrome-extension://ext-id/scan.html" };

const snapshotStorage = (p: Awaited<ReturnType<typeof unlockedService>>["p"]) =>
  JSON.stringify(
    [p.local, p.session, p.sync].map((area) => [...(area as { data: Map<string, unknown> }).data]),
  );

describe("capture", () => {
  it("a capture is handed out once and expires after 60 seconds", async () => {
    const { service, p } = await unlockedService();
    const { id } = await service.storeCapture(CAPTURE);
    expect(await service.takeCapture(id)).toEqual(CAPTURE);
    expect(await codeOf(service.takeCapture(id))).toBe("not-found");

    const second = await service.storeCapture(CAPTURE);
    p.clock.advance(60_001);
    expect(await codeOf(service.takeCapture(second.id))).toBe("not-found");
    // The expired capture is gone, not merely refused.
    p.clock.advance(-60_001);
    expect(await codeOf(service.takeCapture(second.id))).toBe("not-found");
  });

  it("a new capture replaces the old one and a wrong id gets nothing", async () => {
    const { service } = await unlockedService();
    const first = await service.storeCapture(CAPTURE);
    const second = await service.storeCapture({ ...CAPTURE, tabUrl: "https://example.com/" });
    expect(await codeOf(service.takeCapture(first.id))).toBe("not-found");
    expect(await codeOf(service.takeCapture("nope"))).toBe("not-found");
    expect((await service.takeCapture(second.id)).tabUrl).toBe("https://example.com/");
  });

  it("lock drops the capture", async () => {
    const { service } = await unlockedService();
    const { id } = await service.storeCapture(CAPTURE);
    await service.lock();
    expect(await codeOf(service.takeCapture(id))).toBe("not-found");
  });

  it("capture never touches storage", async () => {
    const { service, p } = await unlockedService();
    const before = snapshotStorage(p);
    const { id } = await service.storeCapture(CAPTURE);
    expect(snapshotStorage(p)).toBe(before);
    expect(snapshotStorage(p)).not.toContain("AAAA");
    await service.takeCapture(id);
    expect(snapshotStorage(p)).toBe(before);
  });

  it("rejects non-PNG data, oversized data and a locked vault", async () => {
    const { service } = await unlockedService();
    expect(
      await codeOf(service.storeCapture({ ...CAPTURE, dataUrl: "data:text/html;base64,AA" })),
    ).toBe("invalid-request");
    const huge = `data:image/png;base64,${"A".repeat(32_000_000)}`;
    expect(await codeOf(service.storeCapture({ ...CAPTURE, dataUrl: huge }))).toBe(
      "invalid-request",
    );
    await service.lock();
    expect(await codeOf(service.storeCapture(CAPTURE))).toBe("locked");
  });

  it("is reachable only from the extension's own pages", async () => {
    const { service } = await unlockedService();
    const message = { channel: RPC_CHANNEL, request: { type: "storeCapture", ...CAPTURE } };
    const bad = await handleRpcMessage(
      service,
      message,
      { id: "ext-id", url: "https://evil.example/" },
      CTX,
    );
    expect(bad).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const good = await handleRpcMessage(service, message, TRUSTED, CTX);
    expect(good).toMatchObject({ ok: true });
    const id = (good as { data: { id: string } }).data.id;
    const take = { channel: RPC_CHANNEL, request: { type: "takeCapture", id } };
    const popup = { id: "ext-id", url: "chrome-extension://ext-id/popup.html" };
    expect(await handleRpcMessage(service, take, popup, CTX)).toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });
    expect(await handleRpcMessage(service, take, TRUSTED, CTX)).toMatchObject({ ok: true });
  });
});
