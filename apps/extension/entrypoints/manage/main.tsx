import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <h1>otp-vault</h1>
    </main>
  </StrictMode>,
);
