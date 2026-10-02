// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { finishPngDataUrl, imageToPngDataUrl } from "../src/qr/pngCapture";
import { MAX_CAPTURE_CHARS, MAX_IMAGE_BYTES, QrImageTooLargeError } from "@claviger/ui/qr-limits";

describe("finishPngDataUrl", () => {
  it("accepts a PNG data URL within the capture limit", () => {
    const url = "data:image/png;base64,AAAA";
    expect(finishPngDataUrl(url)).toBe(url);
  });

  it("rejects output over the limit the service accepts", () => {
    const url = `data:image/png;base64,${"A".repeat(MAX_CAPTURE_CHARS)}`;
    expect(() => finishPngDataUrl(url)).toThrow(QrImageTooLargeError);
  });
});

describe("imageToPngDataUrl", () => {
  it("rejects oversized files before reading them", async () => {
    const blob = new Blob(["x"], { type: "image/png" });
    Object.defineProperty(blob, "size", { value: MAX_IMAGE_BYTES + 1 });
    const read = vi.spyOn(blob, "arrayBuffer");
    await expect(imageToPngDataUrl(blob)).rejects.toBeInstanceOf(QrImageTooLargeError);
    expect(read).not.toHaveBeenCalled();
  });
});
