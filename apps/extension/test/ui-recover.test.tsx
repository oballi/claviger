// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecoverScreen } from "@otp-vault/ui/manage";
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
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Yeni kurtarma kodun." }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Kopyala" }));
    const copied = ui.copy.mock.calls[0]![0];
    expect(copied).not.toBe(recoveryCode);
    expect(screen.getByTestId("recovery-code").textContent).toBe(
      copied
        .split("-")
        .map((g, i) => `${i + 1}${g}`)
        .join(""),
    );
    const done = screen.getByRole("button", { name: "Kodlarıma git" });
    expect(done).toHaveProperty("disabled", true);
    await userEvent.click(done);
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Kodu güvenli bir yere kaydettim." }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Kodlarıma git" }));
    expect(onDone).toHaveBeenCalled();
    await vi.waitFor(async () =>
      expect((await ui.rpc("getState", {})).recoveryCodeConfirmed).toBe(true),
    );
    await ui.rpc("lock", {});
    await expect(
      ui.rpc("unlockWithRecovery", { code: copied, newPassword: "ikinci parola cümlesi" }),
    ).resolves.toMatchObject({ recoveryCode: expect.any(String) });
    await ui.rpc("lock", {});
    await expect(
      ui.rpc("unlockWithRecovery", { code: recoveryCode!, newPassword: NEW_PASSWORD }),
    ).rejects.toMatchObject({ code: "invalid-recovery-code" });
    await expect(ui.rpc("unlock", { password: "ikinci parola cümlesi" })).resolves.toBeNull();
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
    const rpc = vi.spyOn(ui, "rpc");
    await fill(recoveryCode!, "short");
    expect(screen.getByText("Parola en az 8 karakter olmalı.")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith("unlockWithRecovery", expect.anything());
    expect((await ui.rpc("getState", {})).status).toBe("locked");
  });

  it("rejects a mismatched confirmation without calling the service", async () => {
    const { ui, recoveryCode } = await open();
    const rpc = vi.spyOn(ui, "rpc");
    await fill(recoveryCode!, NEW_PASSWORD, "başka bir parola");
    expect(screen.getByText("Parolalar eşleşmiyor.")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith("unlockWithRecovery", expect.anything());
  });

  it("clears both password fields after a failed attempt but keeps the code", async () => {
    await open();
    await fill("AAAA-BBBB-CCCC-DDDD");
    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).not.toBe(""));
    expect(screen.getByLabelText<HTMLInputElement>("Yeni ana parola").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Parolayı tekrar gir").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Kurtarma kodu").value).toBe(
      "AAAA-BBBB-CCCC-DDDD",
    );
  });

  it("disables submit with a countdown while throttled, then re-enables", async () => {
    const h = await harness({ status: "locked" });
    for (let i = 0; i < 3; i++)
      await h.ui
        .rpc("unlockWithRecovery", { code: "AAAA-BBBB-CCCC-DDDD", newPassword: NEW_PASSWORD })
        .catch(() => undefined);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderUi(<RecoverScreen hasRecoveryCode={true} onDone={vi.fn()} onCancel={vi.fn()} />, h.ui);
      await fill("AAAA-BBBB-CCCC-DDDD");
      await vi.waitFor(() =>
        expect(screen.getByRole("status").textContent).toBe(
          "Çok fazla hatalı deneme. Kısa bir süre bekle.",
        ),
      );
      expect(screen.getByText(/^\d+ sn$/)).toBeTruthy();
      await userEvent.type(screen.getByLabelText("Yeni ana parola"), NEW_PASSWORD, { delay: null });
      expect(screen.getByRole("button", { name: "Kasayı aç" })).toHaveProperty("disabled", true);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.waitFor(() => expect(screen.getByRole("status").textContent).toBe(""));
      expect(screen.getByRole("button", { name: "Kasayı aç" })).toHaveProperty("disabled", false);
    } finally {
      vi.useRealTimers();
    }
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
