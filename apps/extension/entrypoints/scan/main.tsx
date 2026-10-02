import "../../src/zodConfig";
import "../../src/styles.css";
import { LocaleProvider, pickLocale, UiProvider } from "@otp-vault/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserUiPlatform } from "../../src/platform/uiPlatform";
import { decodeQr } from "../../src/qr/browserDecode";
import { ScanApp } from "../../src/ui/scan/ScanApp";

const locale = pickLocale(navigator.languages);
document.documentElement.lang = locale;
const captureId = window.location.hash.slice(1);
// The id is spent after one take; dropping it keeps a reload from showing a stale link.
history.replaceState(null, "", window.location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiProvider value={createBrowserUiPlatform("scan", { decodeQr })}>
      <LocaleProvider locale={locale}>
        <ScanApp captureId={captureId} />
      </LocaleProvider>
    </UiProvider>
  </StrictMode>,
);
