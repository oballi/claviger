// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearClipboardInDocument,
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
