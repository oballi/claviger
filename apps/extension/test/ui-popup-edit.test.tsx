// apps/extension/test/ui-popup-edit.test.tsx
// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PopupApp } from "@claviger/ui/popup";
import { harness, renderUi } from "./helpers/ui";

async function open(pollMs = 0) {
  const h = await harness();
  const work = await h.ui.rpc("createGroup", { name: "Work" });
  await h.ui.rpc("addAccountUri", {
    uri: "otpauth://totp/PAM:me?secret=JBSWY3DPEHPK3PXP&issuer=PAM",
    sourceUrl: "https://payflex.com.tr",
  });
  renderUi(<PopupApp pollMs={pollMs} />, h.ui);
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

  it("saves without sending the group when it was deleted elsewhere", async () => {
    const h = await harness();
    const work = await h.ui.rpc("createGroup", { name: "Work" });
    const { id } = await h.ui.rpc("addAccountUri", {
      uri: "otpauth://totp/PAM:me?secret=JBSWY3DPEHPK3PXP&issuer=PAM",
    });
    await h.ui.rpc("setAccountGroup", { id, groupId: work.id });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "PAM için işlemler" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Düzenle…" }));
    await screen.findByRole("heading", { name: "Hesabı düzenle." });
    await h.ui.rpc("deleteGroup", { id: work.id });
    await userEvent.type(screen.getByLabelText("Hesap"), "zz");
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await vi.waitFor(async () => expect((await stored(h as never)).label).toBe("mezz"));
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
    await vi.waitFor(() =>
      expect(
        (screen.getByLabelText("Grup") as HTMLSelectElement).selectedOptions[0]!.textContent,
      ).toBe("Family"),
    );
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

  it("focuses the issuer field on open", async () => {
    await open();
    expect(document.activeElement).toBe(screen.getByLabelText("Servis"));
  });

  it("Enter in the new group field creates the group without saving the account", async () => {
    const h = await open();
    await userEvent.click(screen.getByRole("button", { name: "+ Yeni grup" }));
    await userEvent.type(screen.getByLabelText("Yeni grup adı"), "Family{Enter}");
    await vi.waitFor(() =>
      expect(
        (screen.getByLabelText("Grup") as HTMLSelectElement).selectedOptions[0]!.textContent,
      ).toBe("Family"),
    );
    expect(screen.getByRole("heading", { name: "Hesabı düzenle." })).toBeTruthy();
    expect((await stored(h)).groupId).toBeNull();
  });

  it("Escape closes only the new group field, elsewhere it goes back", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "+ Yeni grup" }));
    await userEvent.type(screen.getByLabelText("Yeni grup adı"), "{Escape}");
    expect(screen.queryByLabelText("Yeni grup adı")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ Yeni grup" }));
    expect(screen.getByRole("heading", { name: "Hesabı düzenle." })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Servis"), "{Escape}");
    expect(screen.queryByRole("heading", { name: "Hesabı düzenle." })).toBeNull();
    const trigger = await screen.findByRole("button", { name: "PAM için işlemler" });
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("does not open search on / while editing", async () => {
    await open();
    await userEvent.keyboard("/");
    expect(document.activeElement).not.toBe(screen.queryByRole("searchbox"));
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("shows a save error", async () => {
    const h = await open();
    await h.ui.rpc("deleteAccount", { id: (await stored(h)).id });
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Hesabı düzenle." })).toBeTruthy();
  });

  it("shows the group limit error", async () => {
    const h = await open();
    for (let i = 0; i < 29; i++) await h.ui.rpc("createGroup", { name: `G${i}` });
    await userEvent.click(screen.getByRole("button", { name: "+ Yeni grup" }));
    await userEvent.type(screen.getByLabelText("Yeni grup adı"), "One more");
    await userEvent.click(screen.getAllByRole("button", { name: "Kaydet" })[0]!);
    expect(await screen.findByText("En fazla 30 grup olabilir.")).toBeTruthy();
  });

  it("returns to the list with a notice when the account disappears", async () => {
    const h = await open(30);
    const id = (await stored(h)).id;
    await h.ui.rpc("deleteAccount", { id });
    expect(await screen.findByText("Bu hesap artık yok.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Hesabı düzenle." })).toBeNull();
  });
});
