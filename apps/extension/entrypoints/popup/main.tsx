import "../../src/ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserUiPlatform } from "../../src/platform/uiPlatform";
import { LocaleProvider, pickLocale } from "../../src/ui/i18n/i18n";
import { UiProvider } from "../../src/ui/platform";
import { PopupApp } from "../../src/ui/popup/PopupApp";

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
