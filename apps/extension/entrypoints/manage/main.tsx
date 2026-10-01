import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StatusPlaceholder } from "../../src/ui/StatusPlaceholder";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StatusPlaceholder title="otp-vault — Yönetim" />
  </StrictMode>,
);
