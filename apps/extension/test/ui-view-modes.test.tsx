// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formatCode, maskCode } from "@claviger/ui";
import type { UiPlatform } from "@claviger/ui";
import { CodesScreen } from "@claviger/ui/popup";
import { harness, renderUi } from "./helpers/ui";

const A = "otpauth://totp/Acme:a@x?secret=JBSWY3DPEHPK3PXP&issuer=Acme";

async function popupWith(
  mode: "normal" | "compact" | "hidden",
  opts: {
    tabUrl?: string;
    linked?: boolean;
    wrap?: (ui: UiPlatform) => UiPlatform;
    extra?: string;
  } = {},
) {
  const h = await harness({ tabUrl: opts.tabUrl });
  await h.service.addAccount({ uri: A }, opts.linked ? { sourceUrl: "https://acme.com" } : {});
  if (opts.extra) await h.service.addAccount({ uri: opts.extra });
  await h.service.setViewMode(mode);
  const state = await h.service.getState();
  const { container } = renderUi(
    <CodesScreen state={state} pollMs={0} onLocked={() => {}} />,
    opts.wrap ? opts.wrap(h.ui) : h.ui,
  );
  const { accounts } = await h.service.listAccounts();
  return { h, container, code: accounts[0]!.code };
}

describe("view modes", () => {
  it("rows use the inset rounded hover", async () => {
    await popupWith("normal");
    const row = (await screen.findByText("Acme")).closest("li")!;
    for (const c of ["ov-row", "-mx-3", "px-3", "rounded-xl"]) expect(row.className).toContain(c);
    expect(row.className).not.toContain("hover:bg-hair");
  });

  it("the site row uses it too", async () => {
    await popupWith("normal", { tabUrl: "https://acme.com/login", linked: true });
    const site = (await screen.findByText("Bu site")).closest("section")!;
    const row = within(site).getByText("Acme").closest("li")!;
    expect(row.className).toContain("ov-row");
  });

  it("every row has top padding so the label stays off the hover edge", async () => {
    await popupWith("normal", { tabUrl: "https://acme.com/login", linked: true });
    const site = (await screen.findByText("Bu site")).closest("section")!;
    const large = within(site).getByText("Acme").closest("li")!;
    for (const c of ["ov-row", "-mx-3", "px-3", "pt-3", "pb-5"])
      expect(large.className).toContain(c);
  });

  it("small rows have top padding too", async () => {
    const { container } = await popupWith("normal");
    await screen.findByText("Acme");
    expect(container.querySelector("li")!.className).toContain("pt-3");
  });

  it("hidden mode never puts the code in the DOM but still copies it", async () => {
    const { h, container, code } = await popupWith("hidden");
    const button = await screen.findByRole("button", { name: "Acme kodunu kopyala" });
    expect(container.innerHTML).not.toContain(code);
    expect(container.innerHTML).not.toContain(`${code.slice(0, 3)} ${code.slice(3)}`);
    expect(button.textContent).toBe("••• •••");
    await userEvent.setup().click(button);
    expect(h.ui.copy).toHaveBeenCalledWith(code);
  });

  it("copies when the row text is clicked, in hidden mode too", async () => {
    const hidden = await popupWith("hidden");
    await userEvent.setup().click(await screen.findByText("Acme"));
    expect(hidden.h.ui.copy).toHaveBeenCalledWith(hidden.code);
  });

  it("does not copy while the user has text selected", async () => {
    const { h } = await popupWith("normal");
    const label = await screen.findByText("a@x");
    const range = document.createRange();
    range.selectNodeContents(label);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.click(label);
    window.getSelection()?.removeAllRanges();
    expect(h.ui.copy).not.toHaveBeenCalled();
  });

  it("copies when the issuer text of a normal row is clicked", async () => {
    const { h, code } = await popupWith("normal");
    await userEvent.setup().click(await screen.findByText("a@x"));
    expect(h.ui.copy).toHaveBeenCalledTimes(1);
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
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /^Acme kodunu kopyala/ }));
    await screen.findByText(/kopyalandı/i);
    await vi.waitFor(() => expect(h.p.alarms.scheduled.has("clipboard-clear")).toBe(true));
  });

  it("hides the code in the large this-site row too", async () => {
    const { h, container, code } = await popupWith("hidden", {
      tabUrl: "https://acme.com/login",
      linked: true,
    });
    const button = await screen.findByRole("button", { name: "Acme kodunu kopyala" });
    expect(screen.getByText("Bu site")).toBeTruthy();
    expect(container.innerHTML).not.toContain(code);
    await userEvent.setup().click(button);
    expect(h.ui.copy).toHaveBeenCalledWith(code);
  });

  it("hides the code of an HOTP row", async () => {
    const { container } = await popupWith("hidden", {
      extra: "otpauth://hotp/Bank:ali?secret=JBSWY3DPEHPK3PXP&issuer=Bank&counter=4",
    });
    const button = await screen.findByRole("button", { name: "Bank kodunu kopyala" });
    expect(button.textContent).toBe("\u2022\u2022\u2022 \u2022\u2022\u2022");
    expect(container.querySelectorAll("[data-code-button]")).toHaveLength(2);
  });

  it("keeps the copied toast when reporting the copy fails", async () => {
    await popupWith("normal", {
      wrap: (ui) => ({
        ...ui,
        rpc: (async (type: string, payload: unknown) => {
          if (type === "clipboardCopied") throw new Error("boom");
          return ui.rpc(type as never, payload as never);
        }) as UiPlatform["rpc"],
      }),
    });
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /^Acme kodunu kopyala/ }));
    expect(await screen.findByText(/kopyalandı/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not report a failed copy to the background", async () => {
    const { h } = await popupWith("normal");
    await h.service.setClipboardClear(30);
    h.ui.copy.mockRejectedValueOnce(new Error("denied"));
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /^Acme kodunu kopyala/ }));
    expect(await screen.findByText("Kopyalanamadı.")).toBeTruthy();
    expect(h.p.alarms.scheduled.has("clipboard-clear")).toBe(false);
  });
});

describe("maskCode", () => {
  it.each([6, 7, 8, 5])("groups %i digits like formatCode", (digits) => {
    const digitsText = "1234567890".slice(0, digits);
    expect(maskCode(digits)).toBe(formatCode(digitsText).replace(/\d/g, "\u2022"));
    expect(maskCode(digits)).not.toMatch(/\d/);
  });
});
