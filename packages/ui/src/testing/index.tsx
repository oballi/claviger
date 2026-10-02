import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { LocaleProvider, type Locale } from "../i18n/i18n";
import { UiProvider, type UiPlatform } from "../platform";

/** Wraps `getState` so a test can force a status the real service only reaches after corruption. */
export function withStatus(ui: UiPlatform, status: "unsupported" | "corrupt"): UiPlatform {
  const rpc: UiPlatform["rpc"] = async (type, payload) => {
    if (type === "getState") return { ...(await ui.rpc("getState", {})), status } as never;
    return ui.rpc(type, payload);
  };
  return { ...ui, rpc };
}

export function renderUi(node: ReactNode, ui: UiPlatform, locale: Locale = "tr") {
  return render(
    <UiProvider value={ui}>
      <LocaleProvider locale={locale}>{node}</LocaleProvider>
    </UiProvider>,
  );
}
