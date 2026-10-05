// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CountdownRing } from "@claviger/ui";
import { CodesScreen, PopupApp } from "@claviger/ui/popup";
import { harness, renderUi } from "./helpers/ui";

const A = "otpauth://totp/Acme:a@x?secret=JBSWY3DPEHPK3PXP&issuer=Acme";
const BASE = 1_700_000_000_000 - 20_000; // a multiple of 30 s

afterEach(cleanup);

async function popup(
  opts: {
    remaining?: number;
    mode?: "normal" | "hidden";
    tabUrl?: string;
    lastSeconds?: boolean;
  } = {},
) {
  const h = await harness({ tabUrl: opts.tabUrl });
  await h.service.setShowLastSeconds(opts.lastSeconds ?? true);
  await h.service.addAccount({ uri: A }, opts.tabUrl ? { sourceUrl: "https://acme.com" } : {});
  if (opts.mode) await h.service.setViewMode(opts.mode);
  if (opts.remaining) h.p.clock.ms = BASE + (30 - opts.remaining) * 1000;
  const state = await h.service.getState();
  renderUi(<CodesScreen state={state} pollMs={0} onLocked={() => {}} />, h.ui);
  const [a] = (await h.service.listAccounts()).accounts;
  return { h, account: a! };
}

describe("countdown ring number", () => {
  it("shows seconds only in the last 5 s and labels the ring", () => {
    const { container, rerender } = render(<CountdownRing remaining={12} period={30} />);
    expect(container.textContent).toBe("");
    expect(screen.getByRole("img", { name: "12 s left" })).toBeTruthy();
    rerender(<CountdownRing remaining={4} period={30} />);
    expect(container.textContent).toBe("4");
    expect(screen.getByRole("img", { name: "4 s left" })).toBeTruthy();
    rerender(<CountdownRing remaining={4} period={30} showSeconds={false} />);
    expect(container.textContent).toBe("");
    expect(screen.getByRole("img", { name: "4 s left" })).toBeTruthy();
  });
});

describe("next code in the row", () => {
  it("is absent before the window and the copy uses the current code", async () => {
    const { h, account } = await popup({ remaining: 8 });
    await screen.findByText("Acme");
    expect(account.nextCode).toBeNull();
    expect(document.querySelector("[data-next-code]")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Acme kodunu kopyala/ }));
    expect(h.ui.copy).toHaveBeenCalledWith(account.code);
  });

  it("shows the dimmed next code in the window and copies it", async () => {
    const { h, account } = await popup({ remaining: 7 });
    await h.service.setClipboardClear(30);
    await screen.findByText("Acme");
    const next = document.querySelector("[data-next-code]")!;
    expect(next.textContent).toBe(`${account.nextCode!.slice(0, 3)} ${account.nextCode!.slice(3)}`);
    const button = screen.getByRole("button", { name: "Acme sonraki kodunu kopyala" });
    expect(button.getAttribute("aria-label")).not.toMatch(/\d/);
    await userEvent.click(button);
    expect(h.ui.copy).toHaveBeenCalledWith(account.nextCode);
    expect(h.ui.copy).toHaveBeenLastCalledWith(account.nextCode);
    await vi.waitFor(() => expect(h.p.alarms.scheduled.has("clipboard-clear")).toBe(true));
    expect(button.textContent).toBe("Kopyalandı");
  });

  it("shows neither seconds nor the next code when the setting is off", async () => {
    const { h, account } = await popup({ remaining: 3, lastSeconds: false });
    const row = (await screen.findByText("Acme")).closest("li")!;
    expect(account.nextCode).toBeNull();
    expect(document.querySelector("[data-next-code]")).toBeNull();
    expect(row.querySelector("[role=img]")!.textContent).toBe("");
    await userEvent.click(screen.getByRole("button", { name: /^Acme kodunu kopyala/ }));
    expect(h.ui.copy).toHaveBeenCalledWith(account.code);
  });

  it("is not rendered in Hidden view and copy keeps the current code", async () => {
    const { h, account } = await popup({ remaining: 3, mode: "hidden" });
    await screen.findByText("Acme");
    expect(account.nextCode).not.toBeNull();
    expect(document.body.innerHTML).not.toContain(account.nextCode!);
    expect(document.querySelector("[data-next-code]")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Acme kodunu kopyala" }));
    expect(h.ui.copy).toHaveBeenCalledWith(account.code);
  });
});

describe("row details", () => {
  it("the large This site row shows the account label", async () => {
    await popup({ tabUrl: "https://acme.com/login" });
    const site = (await screen.findByText("Bu site")).closest("section")!;
    expect(site.textContent).toContain("a@x");
  });

  it("delete confirmation focuses Cancel, not Delete", async () => {
    await popup();
    await userEvent.click(await screen.findByRole("button", { name: "Acme için işlemler" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sil…" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Vazgeç" }));
  });

  it("closes the menu on an outside click", async () => {
    await popup();
    await userEvent.click(await screen.findByRole("button", { name: "Acme için işlemler" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("sort mode", () => {
  it("clears a visible toast and explains the pinned site row", async () => {
    const h = await harness({ tabUrl: "https://acme.com/login" });
    await h.service.addAccount({ uri: A }, { sourceUrl: "https://acme.com" });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "Acme için işlemler" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sabitle" }));
    await screen.findByText("Acme sabitlendi.");
    await userEvent.click(screen.getByRole("button", { name: "Sırala" }));
    expect(screen.queryByText("Acme sabitlendi.")).toBeNull();
    expect(await screen.findByText("Bu sitenin hesabı en üstte sabit kalır.")).toBeTruthy();
  });
});
