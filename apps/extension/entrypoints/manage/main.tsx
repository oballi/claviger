import "../../src/zodConfig";
import "../../src/styles.css";
import { applyCachedTheme, LocaleProvider, pickLocale, UiProvider } from "@otp-vault/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserUiPlatform } from "../../src/platform/uiPlatform";
import { decodeQr } from "../../src/qr/browserDecode";
import { ManageApp } from "@otp-vault/ui/manage";

const locale = pickLocale(navigator.languages);
document.documentElement.lang = locale;
applyCachedTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiProvider value={createBrowserUiPlatform("manage", { decodeQr })}>
      <LocaleProvider locale={locale}>
        <ManageApp />
      </LocaleProvider>
    </UiProvider>
  </StrictMode>,
);
