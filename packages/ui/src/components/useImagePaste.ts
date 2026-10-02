import { useEffect, useRef } from "react";

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Image files pasted anywhere outside a text field; text pastes are left to the browser. */
export function useImagePaste(onFiles: (files: File[]) => void, enabled = true): void {
  const latest = useRef(onFiles);
  latest.current = onFiles;
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (event: ClipboardEvent) => {
      if (isEditable(event.target)) return;
      const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (files.length === 0) return;
      event.preventDefault();
      latest.current(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [enabled]);
}
