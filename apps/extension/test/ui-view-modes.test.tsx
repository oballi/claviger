// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CodesScreen } from "../src/ui/popup/CodesScreen";
import { harness, renderUi } from "./helpers/ui";

const A = "otpauth://totp/Acme:a@x?secret=JBSWY3DPEHPK3PXP&issuer=Acme";

async function popupWith(mode: "normal" | "compact" | "hidden") {
  const h = await harness();
  await h.service.addAccount({ uri: A });
  await h.service.setViewMode(mode);
  const state = await h.service.getState();
  const { container } = renderUi(
    <CodesScreen state={state} pollMs={0} onLocked={() => {}} />,
    h.ui,
  );
  const { accounts } = await h.service.listAccounts();
  return { h, container, code: accounts[0]!.code };
}

describe("view modes", () => {
  it("hidden mode never puts the code in the DOM but still copies it", async () => {
    const { h, container, code } = await popupWith("hidden");
    const button = await screen.findByRole("button", { name: "Acme kodunu kopyala" });
    expect(container.innerHTML).not.toContain(code);
    expect(container.innerHTML).not.toContain(`${code.slice(0, 3)} ${code.slice(3)}`);
    expect(button.textContent).toBe("••• •••");
    await userEvent.setup().click(button);
    expect(h.ui.copy).toHaveBeenCalledWith(code);
  });

  it("compact mode drops the account label line", async () => {
    await popupWith("compact");
    await screen.findByText("Acme");
    expect(screen.queryByText("a@x")).toBeNull();
  });

  it("normal mode shows the label line and the code", async () => {
    const { code } = await popupWith("normal");
    expect(await screen.findByText("a@x")).toBeTruthy();
    expect(screen.getByText(`${code.slice(0, 3)} ${code.slice(3)}`)).toBeTruthy();
  });

  it("reports a successful copy to the background for clipboard clearing", async () => {
    const { h } = await popupWith("normal");
    await h.service.setClipboardClear(30);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Acme/ }));
    await screen.findByText(/kopyalandı/i);
    await vi.waitFor(() => expect(h.p.alarms.scheduled.has("clipboard-clear")).toBe(true));
  });
});
