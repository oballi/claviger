// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearClipboardInDocument,
  clearViaOffscreen,
  handleOffscreenMessage,
  type OffscreenPort,
  isOffscreenClear,
  OFFSCREEN_CHANNEL,
} from "../src/platform/clipboard";
import { isRpcEnvelope } from "../src/rpc/server";

function stubExec(fn: () => boolean) {
  Object.defineProperty(document, "execCommand", { value: fn, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(document, "execCommand");
});

describe("clearClipboardInDocument", () => {
  it("copies a selected blank textarea and removes it afterwards", () => {
    let seen: { value: string; selected: boolean; attached: boolean } | undefined;
    stubExec(() => {
      const area = document.querySelector("textarea");
      seen = {
        value: area?.value ?? "",
        selected: area !== null && area.selectionStart === 0 && area.selectionEnd === 1,
        attached: area !== null,
      };
      return true;
    });
    expect(clearClipboardInDocument(document)).toBe(true);
    expect(seen).toEqual({ value: " ", selected: true, attached: true });
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("also sets empty text from the copy event while copying", () => {
    const setData = vi.fn();
    let prevented = false;
    stubExec(() => {
      const event = new Event("copy", { cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", { value: { setData } });
      document.dispatchEvent(event);
      prevented = event.defaultPrevented;
      return true;
    });
    clearClipboardInDocument(document);
    expect(setData).toHaveBeenCalledWith("text/plain", "");
    expect(prevented).toBe(true);
  });

  it("removes its listener and textarea even when copying fails", () => {
    const setData = vi.fn();
    stubExec(() => {
      throw new Error("denied");
    });
    expect(() => clearClipboardInDocument(document)).toThrow();
    expect(document.querySelector("textarea")).toBeNull();
    const event = new Event("copy", { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    document.dispatchEvent(event);
    expect(setData).not.toHaveBeenCalled();
  });

  it("reports a refused copy", () => {
    stubExec(() => false);
    expect(clearClipboardInDocument(document)).toBe(false);
  });
});

describe("offscreen messages", () => {
  it("are recognised and never look like RPC", () => {
    const message = { channel: OFFSCREEN_CHANNEL, type: "clear" };
    expect(isOffscreenClear(message)).toBe(true);
    expect(isRpcEnvelope(message)).toBe(false);
    expect(isOffscreenClear({ channel: OFFSCREEN_CHANNEL, type: "other" })).toBe(false);
    expect(isOffscreenClear(null)).toBe(false);
  });
});

describe("handleOffscreenMessage", () => {
  const msg = { channel: OFFSCREEN_CHANNEL, type: "clear" };
  it("clears for our own extension page", async () => {
    stubExec(() => true);
    await expect(handleOffscreenMessage(msg, { id: "me" }, "me", document)).resolves.toBe(true);
  });
  it("ignores other senders, tab senders and other channels", () => {
    const exec = vi.fn(() => true);
    stubExec(exec);
    expect(handleOffscreenMessage(msg, { id: "evil" }, "me", document)).toBeUndefined();
    expect(handleOffscreenMessage(msg, { id: "me", tab: {} }, "me", document)).toBeUndefined();
    expect(
      handleOffscreenMessage({ channel: "x", type: "clear" }, { id: "me" }, "me", document),
    ).toBeUndefined();
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("clearViaOffscreen", () => {
  const make = (over: Partial<OffscreenPort> = {}) => {
    const port = {
      createDocument: vi.fn(async () => {}),
      closeDocument: vi.fn(async () => {}),
      sendMessage: vi.fn(async () => true as unknown),
      sleep: vi.fn(async () => {}),
      ...over,
    };
    return port;
  };

  it("reuses an already existing document", async () => {
    const port = make({
      createDocument: vi.fn(async () => {
        throw new Error("Only a single offscreen document may be created.");
      }),
    });
    await clearViaOffscreen(port);
    expect(port.sendMessage).toHaveBeenCalledTimes(1);
    expect(port.closeDocument).toHaveBeenCalledTimes(1);
  });

  it("rethrows other create errors and still closes", async () => {
    const port = make({
      createDocument: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await expect(clearViaOffscreen(port)).rejects.toThrow("boom");
    expect(port.closeDocument).toHaveBeenCalledTimes(1);
  });

  it("retries when the document is not ready", async () => {
    const send = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("no receiver"))
      .mockResolvedValueOnce(true);
    const port = make({ sendMessage: send });
    await clearViaOffscreen(port);
    expect(send).toHaveBeenCalledTimes(2);
    expect(port.sleep).toHaveBeenCalledWith(200);
  });

  it("treats false and undefined replies as failures, then throws a name-only error", async () => {
    const send = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(false);
    const port = make({ sendMessage: send });
    await expect(clearViaOffscreen(port)).rejects.toMatchObject({ name: "ClipboardClearError" });
    expect(send).toHaveBeenCalledTimes(3);
    expect(port.closeDocument).toHaveBeenCalledTimes(1);
  });

  it("serializes overlapping clears", async () => {
    const events: string[] = [];
    const port = make({
      createDocument: vi.fn(async () => void events.push("create")),
      closeDocument: vi.fn(async () => void events.push("close")),
    });
    await Promise.all([clearViaOffscreen(port), clearViaOffscreen(port)]);
    expect(events).toEqual(["create", "close", "create", "close"]);
  });
});
