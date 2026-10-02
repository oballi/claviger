import "../../src/styles.css";
import { LocaleProvider, pickLocale, UiProvider } from "@otp-vault/ui";
import { PopupApp } from "@otp-vault/ui/popup";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserUiPlatform } from "../../src/platform/uiPlatform";

const locale = pickLocale(navigator.languages);
document.documentElement.lang = locale;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiProvider value={createBrowserUiPlatform("popup")}>
      <LocaleProvider locale={locale}>
        <PopupApp />
      </LocaleProvider>
    </UiProvider>
  </StrictMode>,
);
