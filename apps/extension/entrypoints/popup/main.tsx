import "../../src/styles.css";
import { applyCachedTheme, LocaleProvider, readCachedLocale, UiProvider } from "@claviger/ui";
import { PopupApp, readCachedPopupSize } from "@claviger/ui/popup";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserUiPlatform } from "../../src/platform/uiPlatform";

const locale = readCachedLocale(navigator.languages);
document.documentElement.lang = locale;
applyCachedTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiProvider value={createBrowserUiPlatform("popup")}>
      <LocaleProvider locale={locale}>
        <PopupApp size={readCachedPopupSize()} />
      </LocaleProvider>
    </UiProvider>
  </StrictMode>,
);
