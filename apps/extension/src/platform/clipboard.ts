export const OFFSCREEN_CHANNEL = "claviger/offscreen";

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

/** Offscreen page handler: only our own extension pages (no tab, same id) may trigger a clear. */
export function handleOffscreenMessage(
  message: unknown,
  sender: { id?: string; tab?: unknown },
  runtimeId: string,
  doc: Document,
): Promise<boolean> | undefined {
  if (!isOffscreenClear(message) || sender.id !== runtimeId || sender.tab !== undefined) {
    return undefined;
  }
  return Promise.resolve(clearClipboardInDocument(doc));
}

export interface OffscreenPort {
  createDocument(): Promise<void>;
  closeDocument(): Promise<void>;
  sendMessage(message: unknown): Promise<unknown>;
  sleep(ms: number): Promise<void>;
}

const MAX_TRIES = 3;
let chain: Promise<unknown> = Promise.resolve();

/** Serialized so overlapping clears cannot close the document under each other. */
export function clearViaOffscreen(port: OffscreenPort): Promise<void> {
  const run = chain.then(() => clearOnce(port));
  chain = run.catch(() => undefined);
  return run;
}

async function clearOnce(port: OffscreenPort): Promise<void> {
  try {
    try {
      await port.createDocument();
    } catch (e) {
      if (!(e instanceof Error && /single offscreen document/i.test(e.message))) throw e;
    }
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      try {
        const reply = await port.sendMessage({ channel: OFFSCREEN_CHANNEL, type: "clear" });
        if (reply === true) return;
      } catch {
        // Listener may not be registered yet; retry below.
      }
      if (attempt < MAX_TRIES) await port.sleep(200 * attempt);
    }
    const error = new Error("clipboard clear failed");
    error.name = "ClipboardClearError";
    throw error;
  } finally {
    await port.closeDocument().catch(() => {});
  }
}
