// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LockScreen } from "../src/ui/components/LockScreen";
import { StatusScreen } from "../src/ui/components/StatusScreen";
import { harness, renderUi, type Harness } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";

async function openLock(h: Harness, extra: { onChangePolicy?: () => void } = {}) {
  const onUnlocked = vi.fn();
  const onForgot = vi.fn();
  const state = await h.ui.rpc("getState", {});
  renderUi(
    <LockScreen state={state} onUnlocked={onUnlocked} onForgot={onForgot} {...extra} />,
    h.ui,
  );
  return { onUnlocked, onForgot };
}

describe("LockScreen", () => {
  it("shows how many accounts are locked and the lock policy", async () => {
    const h = await harness({ lockPolicy: { kind: "timeout", minutes: 60 } });
    await h.ui.rpc("addAccountUri", { uri: "otpauth://totp/A?secret=JBSWY3DPEHPK3PXP" });
    await h.ui.rpc("lock", {});
    const onChangePolicy = vi.fn();
    await openLock(h, { onChangePolicy });
    expect(screen.getByRole("heading", { name: "Kasa kilitli." })).toBeTruthy();
    expect(screen.getByText("1 hesabın kodları ana parolanın arkasında.")).toBeTruthy();
    expect(screen.getByText("1 saat kullanılmayınca kilitlenir")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Değiştir" }));
    expect(onChangePolicy).toHaveBeenCalled();
  });

  it("unlocks with the right password", async () => {
    const h = await harness({ status: "locked" });
    const { onUnlocked } = await openLock(h);
    expect(screen.queryByRole("button", { name: "Değiştir" })).toBeNull();
    await userEvent.type(screen.getByLabelText("Ana parola"), `${PASSWORD}{Enter}`);
    await vi.waitFor(() => expect(onUnlocked).toHaveBeenCalled());
    expect((await h.ui.rpc("getState", {})).status).toBe("unlocked");
  });

  it("sends a forgotten password to recovery", async () => {
    const h = await harness({ status: "locked" });
    const { onForgot } = await openLock(h);
    await userEvent.click(screen.getByRole("button", { name: "Parolamı unuttum" }));
    expect(onForgot).toHaveBeenCalled();
  });

  it("says the password was wrong and shows the countdown with a disabled button", async () => {
    const h = await harness({ status: "locked" });
    await openLock(h);
    const field = screen.getByLabelText("Ana parola");
    for (let i = 0; i < 3; i++) {
      await userEvent.type(field, "wrong password");
      await userEvent.click(screen.getByRole("button", { name: "Kilidi aç" }));
      await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Parola yanlış."));
    }
    expect(screen.getByRole("status").textContent).toBe(
      "Çok fazla hatalı deneme. 2 sn sonra tekrar dene.",
    );
    await userEvent.type(field, "x");
    expect(screen.getByRole("button", { name: "Kilidi aç" })).toHaveProperty("disabled", true);
  });

  it("continues an earlier throttle when reopened", async () => {
    const h = await harness({ status: "locked" });
    for (let i = 0; i < 3; i++)
      await h.ui.rpc("unlock", { password: "wrong password" }).catch(() => undefined);
    await openLock(h);
    expect(screen.getByRole("status").textContent).toBe(
      "Çok fazla hatalı deneme. 2 sn sonra tekrar dene.",
    );
  });

  it("uses a generic sentence when the account count is unknown", async () => {
    const h = await harness({ status: "locked" });
    renderUi(
      <LockScreen
        state={{ retryAfterMs: 0, lockPolicy: { kind: "never" }, accountCount: null }}
        onUnlocked={() => {}}
        onForgot={() => {}}
        title="Kasan bulundu."
      />,
      h.ui,
    );
    expect(screen.getByRole("heading", { name: "Kasan bulundu." })).toBeTruthy();
    expect(screen.getByText("Kodların ana parolanın arkasında.")).toBeTruthy();
    expect(screen.getByText("Kendiliğinden kilitlenmez")).toBeTruthy();
  });
});

describe("StatusScreen", () => {
  it("shows an optional action", async () => {
    const { ui } = await harness();
    const onAction = vi.fn();
    renderUi(
      <StatusScreen title="Başlık." body="Metin" actionLabel="Yap" onAction={onAction} />,
      ui,
    );
    await userEvent.click(screen.getByRole("button", { name: "Yap" }));
    expect(onAction).toHaveBeenCalled();
  });
});
