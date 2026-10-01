import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16, width: 320 }}>
      <h1 style={{ fontSize: 16 }}>otp-vault 0.0.1</h1>
    </main>
  </StrictMode>,
);
