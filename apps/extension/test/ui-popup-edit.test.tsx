// apps/extension/test/ui-popup-edit.test.tsx
// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PopupApp } from "@otp-vault/ui/popup";
import { harness, renderUi } from "./helpers/ui";

async function open() {
  const h = await harness();
  const work = await h.ui.rpc("createGroup", { name: "Work" });
  await h.ui.rpc("addAccountUri", {
    uri: "otpauth://totp/PAM:me?secret=JBSWY3DPEHPK3PXP&issuer=PAM",
    sourceUrl: "https://payflex.com.tr",
  });
  renderUi(<PopupApp pollMs={0} />, h.ui);
  await userEvent.click(await screen.findByRole("button", { name: "PAM için işlemler" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Düzenle…" }));
  await screen.findByRole("heading", { name: "Hesabı düzenle." });
  return { ...h, work };
}
const stored = async (h: Awaited<ReturnType<typeof open>>) =>
  (await h.ui.rpc("listAccounts", {})).accounts[0]!;
beforeEach(() => localStorage.clear());

describe("popup edit view", () => {
  it("shows the fields, saves issuer, label and group", async () => {
    const h = await open();
    expect((screen.getByLabelText("Servis") as HTMLInputElement).value).toBe("PAM");
    await userEvent.selectOptions(screen.getByLabelText("Grup"), "Work");
    await userEvent.clear(screen.getByLabelText("Hesap"));
    await userEvent.type(screen.getByLabelText("Hesap"), "oballi");
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await vi.waitFor(async () =>
      expect(await stored(h)).toMatchObject({ label: "oballi", groupId: h.work.id }),
    );
    expect(await screen.findByText(/PAM/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Hesabı düzenle." })).toBeNull();
  });

  it("removes a linked site only on save", async () => {
    const h = await open();
    await userEvent.click(
      screen.getByRole("button", { name: "payflex.com.tr bağlantısını kaldır" }),
    );
    expect((await stored(h)).domains).toEqual(["payflex.com.tr"]);
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await vi.waitFor(async () => expect((await stored(h)).domains).toEqual([]));
  });

  it("creates a group inline and selects it", async () => {
    const h = await open();
    await userEvent.click(screen.getByRole("button", { name: "+ Yeni grup" }));
    await userEvent.type(screen.getByLabelText("Yeni grup adı"), "Family");
    await userEvent.click(screen.getAllByRole("button", { name: "Kaydet" })[0]!);
    expect(
      (screen.getByLabelText("Grup") as HTMLSelectElement).selectedOptions[0]!.textContent,
    ).toBe("Family");
    await userEvent.click(screen.getAllByRole("button", { name: "Kaydet" }).at(-1)!);
    await vi.waitFor(async () => expect((await stored(h)).groupId).not.toBeNull());
  });

  it("shows a duplicate group error", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "+ Yeni grup" }));
    await userEvent.type(screen.getByLabelText("Yeni grup adı"), "work");
    await userEvent.click(screen.getAllByRole("button", { name: "Kaydet" })[0]!);
    expect(await screen.findByText("Bu adla bir grup zaten var.")).toBeTruthy();
  });

  it("goes back without saving", async () => {
    const h = await open();
    await userEvent.type(screen.getByLabelText("Hesap"), "zzz");
    await userEvent.click(screen.getByRole("button", { name: "Geri" }));
    expect((await stored(h)).label).toBe("me");
  });

  it("returns focus to the row menu trigger after going back", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Geri" }));
    const trigger = await screen.findByRole("button", { name: "PAM için işlemler" });
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
