// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecoverScreen } from "../src/ui/manage/RecoverScreen";
import { harness, renderUi } from "./helpers/ui";

const NEW_PASSWORD = "yeni parola cümlesi";

async function open(recoveryCode = true) {
  const h = await harness({ status: "locked", recoveryCode });
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const { hasRecoveryCode } = await h.ui.rpc("getState", {});
  renderUi(
    <RecoverScreen hasRecoveryCode={hasRecoveryCode} onDone={onDone} onCancel={onCancel} />,
    h.ui,
  );
  return { ...h, onDone, onCancel };
}

async function fill(code: string, password = NEW_PASSWORD, confirm = password) {
  await userEvent.type(screen.getByLabelText("Kurtarma kodu"), code);
  await userEvent.type(screen.getByLabelText("Yeni ana parola"), password);
  await userEvent.type(screen.getByLabelText("Parolayı tekrar gir"), confirm);
  await userEvent.click(screen.getByRole("button", { name: "Kasayı aç" }));
}

describe("RecoverScreen", () => {
  it("unlocks, sets a new password and shows a replacement code", async () => {
    const { ui, recoveryCode, onDone } = await open();
    expect(document.activeElement).toBe(screen.getByLabelText("Kurtarma kodu"));
    await fill(recoveryCode!);
    expect(await screen.findByRole("heading", { name: "Yeni kurtarma kodun." })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Yeni kurtarma kodun." }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Kopyala" }));
    expect(ui.copy.mock.calls[0]![0]).not.toBe(recoveryCode);
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Kodu güvenli bir yere kaydettim." }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Kodlarıma git" }));
    expect(onDone).toHaveBeenCalled();
    await ui.rpc("lock", {});
    await expect(
      ui.rpc("unlockWithRecovery", { code: recoveryCode!, newPassword: NEW_PASSWORD }),
    ).rejects.toMatchObject({ code: "invalid-recovery-code" });
    await expect(ui.rpc("unlock", { password: NEW_PASSWORD })).resolves.toBeNull();
  });

  it("rejects a wrong code and keeps the form", async () => {
    await open();
    await fill("AAAA-BBBB-CCCC-DDDD");
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Kurtarma kodu doğru değil."),
    );
    expect(screen.getByLabelText("Kurtarma kodu")).toBeTruthy();
  });

  it("checks the new password before calling the service", async () => {
    const { ui, recoveryCode } = await open();
    await fill(recoveryCode!, "short");
    expect(screen.getByText("Parola en az 8 karakter olmalı.")).toBeTruthy();
    expect((await ui.rpc("getState", {})).status).toBe("locked");
  });

  it("explains that there is no way back without a recovery code", async () => {
    const { onCancel } = await open(false);
    expect(
      screen.getByText(
        "Bu kasa için kurtarma kodu oluşturulmamış. Parolanı hatırlamıyorsan kodlarına erişilemez.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Kurtarma kodu")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Geri" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
