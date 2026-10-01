export const OFFSCREEN_CHANNEL = "otp-vault/offscreen";

export function isOffscreenClear(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { channel?: unknown }).channel === OFFSCREEN_CHANNEL &&
    (message as { type?: unknown }).type === "clear"
  );
}

/**
 * Extensions may not read the clipboard to check it first, so the clear is unconditional.
 * A selected blank textarea is the copy source that works in an offscreen document; the copy-event
 * listener is a secondary path for engines that honour setData during the command.
 */
export function clearClipboardInDocument(doc: Document): boolean {
  const onCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData("text/plain", "");
    event.preventDefault();
  };
  const area = doc.createElement("textarea");
  area.value = " ";
  doc.body.appendChild(area);
  doc.addEventListener("copy", onCopy);
  try {
    area.select();
    return doc.execCommand("copy");
  } finally {
    doc.removeEventListener("copy", onCopy);
    area.remove();
  }
}
