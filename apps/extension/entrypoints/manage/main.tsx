import "../../src/ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserUiPlatform } from "../../src/platform/uiPlatform";
import { LocaleProvider, pickLocale } from "../../src/ui/i18n/i18n";
import { ManageApp } from "../../src/ui/manage/ManageApp";
import { UiProvider } from "../../src/ui/platform";

const locale = pickLocale(navigator.languages);
document.documentElement.lang = locale;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiProvider value={createBrowserUiPlatform("manage")}>
      <LocaleProvider locale={locale}>
        <ManageApp />
      </LocaleProvider>
    </UiProvider>
  </StrictMode>,
);
