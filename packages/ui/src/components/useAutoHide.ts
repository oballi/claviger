import { useLayoutEffect, useRef, useState } from "react";

/** Counts down while `active` and calls `onHide` on timeout or when the page is hidden. */
export function useAutoHide(
  active: boolean,
  ms: number,
  onHide: () => void,
): { secondsLeft: number } {
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(ms / 1000));
  // Callers pass inline arrows; keeping them out of the deps stops the countdown restarting every render.
  const hideRef = useRef(onHide);
  hideRef.current = onHide;

  // Layout effect: the hidden-page listener must exist in the same commit that shows the secret.
  useLayoutEffect(() => {
    if (!active) return;
    if (document.visibilityState === "hidden") {
      hideRef.current();
      return;
    }
    const end = Date.now() + ms;
    setSecondsLeft(Math.ceil(ms / 1000));
    const tick = setInterval(() => {
      const left = Math.ceil((end - Date.now()) / 1000);
      if (left <= 0) hideRef.current();
      else setSecondsLeft(left);
    }, 1000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hideRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, ms]);

  return { secondsLeft };
}
